#!/usr/bin/env python3
"""Verify F2RE release inputs and build one offline stack archive."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile
import tempfile
from typing import Optional
import zipfile

SCHEMA = "f2re-stack-bundle/v1"
PROJECT_SCHEMA = "f2re-managed-service/v1"
META_SCHEMA = "f2re-meta-bundle/v1"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_sidecar(path: Path) -> str:
    sidecar = Path(f"{path}.sha256")
    if not sidecar.is_file():
        raise SystemExit(f"Нет checksum: {sidecar}")
    parts = sidecar.read_text(encoding="utf-8").strip().split()
    if len(parts) < 2 or not re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
        raise SystemExit(f"Некорректный checksum-файл: {sidecar}")
    if Path(parts[-1].lstrip("*")).name != path.name:
        raise SystemExit(f"Checksum {sidecar} относится не к {path.name}")
    actual = sha256_file(path)
    if actual.lower() != parts[0].lower():
        raise SystemExit(f"SHA-256 не совпал: {path}")
    return actual


def safe_tar_members(archive: tarfile.TarFile):
    members = archive.getmembers()
    if not members:
        raise SystemExit("Пустой TAR archive")
    for member in members:
        name = member.name
        parts = Path(name).parts
        if Path(name).is_absolute() or ".." in parts or "\\" in name:
            raise SystemExit(f"Небезопасный TAR path: {name}")
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise SystemExit(f"Неподдерживаемый TAR member: {name}")
    return members


def inspect_meta(path: Path, managed: dict, expected_commit: Optional[str]):
    digest = verify_sidecar(path)
    with tarfile.open(path, "r:gz") as archive:
        members = safe_tar_members(archive)
        roots = {Path(member.name).parts[0] for member in members if Path(member.name).parts}
        if len(roots) != 1:
            raise SystemExit(f"Meta-bundle должен иметь один корень: {path}")
        root = next(iter(roots))
        names = {member.name.rstrip("/") for member in members}
        required = [f"{root}/meta-release.json", f"{root}/managed-projects.json", f"{root}/verify.sh", f"{root}/install.sh"]
        for name in required:
            if name not in names:
                raise SystemExit(f"В meta-bundle отсутствует {name}")
        release = json.loads(archive.extractfile(f"{root}/meta-release.json").read())
        embedded = json.loads(archive.extractfile(f"{root}/managed-projects.json").read())
    if release.get("schema") != META_SCHEMA:
        raise SystemExit("Неверная schema meta-bundle")
    target = release.get("target") or {}
    if target.get("os") != "astra-linux-special-edition" or not str(target.get("version", "")).startswith("1.8"):
        raise SystemExit("Meta-bundle собран не для Astra Linux 1.8")
    if target.get("architecture") != "amd64":
        raise SystemExit("One-shot stack v1 публикуется для amd64")
    if expected_commit and release.get("sourceCommit") != expected_commit:
        raise SystemExit(f"Meta sourceCommit {release.get('sourceCommit')} != {expected_commit}")
    if embedded != managed:
        raise SystemExit("managed-projects.json внутри meta-bundle отличается от текущего manifest")
    return {
        "file": path.name,
        "sha256": digest,
        "version": release.get("version"),
        "sourceCommit": release.get("sourceCommit"),
        "target": target,
    }


def inspect_project(path: Path, project: dict):
    digest = verify_sidecar(path)
    with zipfile.ZipFile(path) as package:
        names = package.namelist()
        if "f2re-service.json" not in names:
            raise SystemExit(f"Нет f2re-service.json: {path}")
        manifest = json.loads(package.read("f2re-service.json"))
        payload = (manifest.get("payload") or {}).get("path")
        allowed = {"f2re-service.json", payload}
        if "f2re-service.sig" in names:
            allowed.add("f2re-service.sig")
        if set(names) != allowed:
            raise SystemExit(f"Лишние/недостающие файлы в {path.name}: {sorted(set(names) ^ allowed)}")
        if not payload or not payload.startswith("payload/"):
            raise SystemExit(f"Некорректный payload path: {path.name}")
        payload_digest = hashlib.sha256()
        payload_size = 0
        with package.open(payload) as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                payload_digest.update(chunk)
                payload_size += len(chunk)
    expected = {
        "schema": PROJECT_SCHEMA,
        "controllerApi": 1,
        "projectId": project["projectId"],
        "adapter": project["adapter"],
        "nativeBundleFormat": project["nativeBundleFormat"],
        "sourceCommit": project["verifiedCommit"],
    }
    for key, value in expected.items():
        if manifest.get(key) != value:
            raise SystemExit(f"{path.name}: {key}={manifest.get(key)!r}, ожидалось {value!r}")
    declared = manifest["payload"]
    if declared.get("sha256") != payload_digest.hexdigest() or declared.get("size") != payload_size:
        raise SystemExit(f"{path.name}: payload checksum/size не совпадает")
    return {
        "projectId": project["projectId"],
        "displayName": project["displayName"],
        "repository": project["repository"],
        "file": path.name,
        "sha256": digest,
        "version": manifest.get("version"),
        "sourceCommit": manifest.get("sourceCommit"),
        "adapter": manifest.get("adapter"),
        "nativeBundleFormat": manifest.get("nativeBundleFormat"),
    }


def single_match(root: Path, pattern: str) -> Path:
    matches = sorted(root.glob(pattern))
    if len(matches) != 1:
        raise SystemExit(f"Ожидался ровно один {pattern} в {root}, найдено {len(matches)}")
    return matches[0]


def verify_inputs(artifacts: Path, managed_path: Path, meta_commit: Optional[str]):
    managed = read_json(managed_path)
    if managed.get("schema") != "f2re-managed-projects/v1":
        raise SystemExit("Некорректный managed-projects.json")
    meta = inspect_meta(single_match(artifacts, "f2re-meta-*.tar.gz"), managed, meta_commit)
    projects = []
    for project in managed["projects"]:
        package = single_match(artifacts, project["release"]["artifactPattern"])
        projects.append(inspect_project(package, project))
    return {"meta": meta, "projects": projects, "managed": managed}


def write_checksums(root: Path):
    lines = []
    for path in sorted(p for p in root.rglob("*") if p.is_file() and p.name != "SHA256SUMS"):
        lines.append(f"{sha256_file(path)}  {path.relative_to(root).as_posix()}\n")
    (root / "SHA256SUMS").write_text("".join(lines), encoding="utf-8")


def verify_bundle(root: Path):
    release = read_json(root / "stack-release.json")
    if release.get("schema") != SCHEMA:
        raise SystemExit("Неверная schema stack-release.json")
    checksums = root / "SHA256SUMS"
    if not checksums.is_file():
        raise SystemExit("Нет SHA256SUMS")
    for line in checksums.read_text(encoding="utf-8").splitlines():
        digest, relative = line.split(None, 1)
        relative = relative.strip().lstrip("*")
        target = (root / relative).resolve()
        if root.resolve() not in target.parents:
            raise SystemExit(f"Небезопасный checksum path: {relative}")
        if not target.is_file() or sha256_file(target) != digest:
            raise SystemExit(f"Checksum не совпал: {relative}")
    meta_file = root / "meta" / release["meta"]["file"]
    if not meta_file.is_file():
        raise SystemExit("Meta archive отсутствует")
    for project in release["projects"]:
        path = root / "projects" / project["file"]
        if not path.is_file():
            raise SystemExit(f"Нет package {project['projectId']}: {path.name}")
    print(f"stack-ok: {len(release['projects'])} projects + meta {release['meta']['version']}")
    return release


def pack(artifacts: Path, managed_path: Path, output: Path, version: str, meta_commit: str):
    info = verify_inputs(artifacts, managed_path, meta_commit)
    scripts = Path(__file__).resolve().parent
    with tempfile.TemporaryDirectory(prefix="f2re-stack-") as temp:
        temp_root = Path(temp)
        name = f"f2re-stack-{version}-astra-1.8-amd64"
        root = temp_root / name
        (root / "meta").mkdir(parents=True)
        (root / "projects").mkdir()
        meta_source = artifacts / info["meta"]["file"]
        for source in (meta_source, Path(f"{meta_source}.sha256")):
            shutil.copy2(source, root / "meta" / source.name)
        for project in info["projects"]:
            source = artifacts / project["file"]
            for item in (source, Path(f"{source}.sha256")):
                shutil.copy2(item, root / "projects" / item.name)
        for filename in ("deploy-stack.sh", "apply-package.py", "stack_tool.py"):
            shutil.copy2(scripts / filename, root / filename)
        release = {
            "schema": SCHEMA,
            "version": version,
            "builtAt": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "sourceCommit": meta_commit,
            "target": {"os": "astra-linux-special-edition", "version": "1.8", "architecture": "amd64"},
            "meta": info["meta"],
            "projects": info["projects"],
        }
        (root / "stack-release.json").write_text(json.dumps(release, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        (root / "verify.sh").write_text(
            '#!/usr/bin/env bash\nset -Eeuo pipefail\nDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"\nexec python3 "$DIR/stack_tool.py" verify-bundle "$DIR"\n',
            encoding="utf-8",
        )
        (root / "README-INSTALL.txt").write_text(
            f"F2RE Stack {version} / Astra Linux 1.8 amd64\n\n"
            "Проверка: ./verify.sh\n"
            "Полное развёртывание: sudo ./deploy-stack.sh\n"
            "Только приложения поверх установленного Project Control: sudo ./deploy-stack.sh --skip-meta\n"
            "Проверка без изменений: sudo ./deploy-stack.sh --dry-run\n",
            encoding="utf-8",
        )
        for executable in ("verify.sh", "deploy-stack.sh", "apply-package.py", "stack_tool.py"):
            (root / executable).chmod(0o755)
        write_checksums(root)
        output.mkdir(parents=True, exist_ok=True)
        archive_path = output / f"{name}.tar.gz"
        with archive_path.open("wb") as raw:
            proc_gzip = subprocess.Popen(["gzip", "-n", "-6"], stdin=subprocess.PIPE, stdout=raw)
            subprocess.run(
                ["tar", "--sort=name", "--owner=0", "--group=0", "--numeric-owner", "-C", str(temp_root), "-cf", "-", name],
                stdout=proc_gzip.stdin,
                check=True,
            )
            proc_gzip.stdin.close()
            if proc_gzip.wait() != 0:
                raise SystemExit("gzip завершился с ошибкой")
        Path(f"{archive_path}.sha256").write_text(f"{sha256_file(archive_path)}  {archive_path.name}\n", encoding="utf-8")
        print(archive_path)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    verify_inputs_parser = sub.add_parser("verify-inputs")
    verify_inputs_parser.add_argument("artifacts")
    verify_inputs_parser.add_argument("managed")
    verify_inputs_parser.add_argument("--meta-commit")
    verify_bundle_parser = sub.add_parser("verify-bundle")
    verify_bundle_parser.add_argument("root")
    pack_parser = sub.add_parser("pack")
    pack_parser.add_argument("artifacts")
    pack_parser.add_argument("managed")
    pack_parser.add_argument("output")
    pack_parser.add_argument("--version", required=True)
    pack_parser.add_argument("--meta-commit", required=True)
    args = parser.parse_args()
    if args.command == "verify-inputs":
        info = verify_inputs(Path(args.artifacts), Path(args.managed), args.meta_commit)
        print(json.dumps({"meta": info["meta"], "projects": info["projects"]}, ensure_ascii=False, indent=2))
    elif args.command == "verify-bundle":
        verify_bundle(Path(args.root).resolve())
    elif args.command == "pack":
        pack(Path(args.artifacts).resolve(), Path(args.managed).resolve(), Path(args.output).resolve(), args.version, args.meta_commit)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
