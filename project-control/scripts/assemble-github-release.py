#!/usr/bin/env python3
"""Assemble the complete immutable F2RE GitHub Release asset set."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import tempfile
import zipfile

import stack_tool

SCHEMA = "f2re-github-release/v2"
TARGETS = ("1.7", "1.8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def single(root: Path, pattern: str) -> Path:
    matches = sorted(root.glob(pattern))
    if len(matches) != 1:
        raise SystemExit(f"Ожидался ровно один {pattern} в {root}, найдено {len(matches)}")
    return matches[0]


def verify_sidecar(path: Path) -> None:
    sidecar = Path(f"{path}.sha256")
    if not sidecar.is_file():
        raise SystemExit(f"Нет SHA-256 sidecar: {sidecar}")
    parts = sidecar.read_text(encoding="utf-8").strip().split()
    if len(parts) < 2 or not re.fullmatch(r"[0-9a-fA-F]{64}", parts[0]):
        raise SystemExit(f"Некорректный sidecar: {sidecar}")
    if Path(parts[-1].lstrip("*")).name != path.name:
        raise SystemExit(f"Sidecar {sidecar.name} относится не к {path.name}")
    if parts[0].lower() != sha256_file(path):
        raise SystemExit(f"SHA-256 не совпал: {path}")


def copy_pair(source: Path, output: Path) -> Path:
    verify_sidecar(source)
    target = output / source.name
    shutil.copy2(source, target)
    shutil.copy2(Path(f"{source}.sha256"), Path(f"{target}.sha256"))
    return target


def alias_pair(source: Path, alias_name: str, output: Path) -> Path:
    alias = output / alias_name
    shutil.copy2(source, alias)
    digest = sha256_file(alias)
    Path(f"{alias}.sha256").write_text(f"{digest}  {alias.name}\n", encoding="utf-8")
    return alias


def load_managed(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("schema") != "f2re-managed-projects/v1" or data.get("controllerApi") != 1:
        raise SystemExit("Некорректный managed-projects.json")
    if {p.get("projectId") for p in data.get("projects", [])} != {"docomator", "planer-solving", "kafedra-planner"}:
        raise SystemExit("Release assembler ожидает три управляемых проекта")
    return data


def create_meta_aggregate(output: Path, version: str) -> Path:
    name = f"f2re-meta-{version}-all-astra-amd64.zip"
    target = output / name
    members = []
    for astra in TARGETS:
        for suffix in ("", ".sha256"):
            members.append(output / f"f2re-meta-{version}-astra-{astra}-amd64.tar.gz{suffix}")
    members += [
        output / f"project-control-{version}-linux-x64.tar.gz",
        output / f"project-control-{version}-linux-x64.tar.gz.sha256",
        output / "install-project-control.sh",
    ]
    with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_STORED) as archive:
        for member in members:
            if not member.is_file():
                raise SystemExit(f"Не найден aggregate member: {member}")
            archive.write(member, member.name)
    Path(f"{target}.sha256").write_text(f"{sha256_file(target)}  {target.name}\n", encoding="utf-8")
    return target


def classify(name: str) -> str:
    if name.startswith("f2re-stack-") or name.startswith("f2re-stack-astra-"):
        return "full-stack"
    if name.endswith("-project-control.f2re.zip") or name in {
        "docomator-project-control.f2re.zip",
        "planer-solving-project-control.f2re.zip",
        "kafedra-planner-project-control.f2re.zip",
    }:
        return "managed-update"
    if name.startswith("f2re-meta-") and name.endswith((".tar.gz", ".zip")):
        return "meta-bundle"
    if name.startswith("project-control-") and name.endswith(".tar.gz"):
        return "controller"
    if name == "install-project-control.sh":
        return "installer"
    return "artifact"


def write_manifest(output: Path, version: str, commit: str, managed: dict) -> Path:
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise SystemExit("source commit должен быть полным SHA")
    binary_assets = []
    for path in sorted(p for p in output.iterdir() if p.is_file() and not p.name.endswith(".sha256") and p.name not in {"release-manifest.json", "SHA256SUMS"}):
        binary_assets.append({
            "name": path.name,
            "kind": classify(path.name),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        })
    projects = []
    for project in managed["projects"]:
        pattern = project["release"]["artifactPattern"]
        package = single(output, pattern)
        projects.append({
            "projectId": project["projectId"],
            "repository": project["repository"],
            "sourceCommit": project["verifiedCommit"],
            "adapter": project["adapter"],
            "package": package.name,
            "stableAlias": f"{project['projectId']}-project-control.f2re.zip",
        })
    manifest = {
        "schema": SCHEMA,
        "version": version,
        "tag": f"v{version}",
        "sourceCommit": commit,
        "targets": [
            {"os": "Astra Linux Special Edition", "version": astra, "arch": "amd64", "metaBundle": f"f2re-meta-{version}-astra-{astra}-amd64.tar.gz", "fullStack": f"f2re-stack-{version}-astra-{astra}-amd64.tar.gz"}
            for astra in TARGETS
        ],
        "managedProjects": projects,
        "assets": binary_assets,
    }
    target = output / "release-manifest.json"
    target.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


def write_sums(output: Path) -> Path:
    target = output / "SHA256SUMS"
    lines = []
    for path in sorted(p for p in output.iterdir() if p.is_file() and p.name != "SHA256SUMS"):
        lines.append(f"{sha256_file(path)}  {path.name}\n")
    target.write_text("".join(lines), encoding="utf-8")
    return target


def assemble(input_dir: Path, output: Path, version: str, commit: str, managed_path: Path) -> Path:
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[+-][0-9A-Za-z.-]+)?", version):
        raise SystemExit(f"Некорректная release version: {version}")
    managed = load_managed(managed_path)
    if output.exists():
        shutil.rmtree(output)
    output.mkdir(parents=True)

    controller = single(input_dir, f"project-control-{version}-linux-x64.tar.gz")
    copy_pair(controller, output)
    installer = input_dir / "install-project-control.sh"
    if not installer.is_file():
        raise SystemExit("install-project-control.sh отсутствует")
    shutil.copy2(installer, output / installer.name)
    alias_pair(output / controller.name, "project-control-linux-x64.tar.gz", output)

    meta_by_target = {}
    for astra in TARGETS:
        meta = single(input_dir, f"f2re-meta-{version}-astra-{astra}-amd64.tar.gz")
        copy_pair(meta, output)
        meta_by_target[astra] = meta
        alias_pair(output / meta.name, f"f2re-meta-astra-{astra}-amd64.tar.gz", output)

    project_sources = {}
    for project in managed["projects"]:
        package = single(input_dir, project["release"]["artifactPattern"])
        copy_pair(package, output)
        project_sources[project["projectId"]] = package
        alias_pair(output / package.name, f"{project['projectId']}-project-control.f2re.zip", output)

    with tempfile.TemporaryDirectory(prefix="f2re-release-stack-") as temp:
        temp_root = Path(temp)
        stack_out = temp_root / "stack-out"
        for astra in TARGETS:
            target_input = temp_root / f"input-{astra}"
            target_input.mkdir()
            source_meta = input_dir / f"f2re-meta-{version}-astra-{astra}-amd64.tar.gz"
            shutil.copy2(source_meta, target_input / source_meta.name)
            shutil.copy2(Path(f"{source_meta}.sha256"), target_input / f"{source_meta.name}.sha256")
            for package in project_sources.values():
                shutil.copy2(package, target_input / package.name)
                shutil.copy2(Path(f"{package}.sha256"), target_input / f"{package.name}.sha256")
            stack_tool.pack(target_input, managed_path, stack_out, version, commit, astra)
            stack = stack_out / f"f2re-stack-{version}-astra-{astra}-amd64.tar.gz"
            copy_pair(stack, output)
            alias_pair(output / stack.name, f"f2re-stack-astra-{astra}-amd64.tar.gz", output)

    aggregate = create_meta_aggregate(output, version)
    alias_pair(aggregate, "f2re-meta-all-astra-amd64.zip", output)
    write_manifest(output, version, commit, managed)
    write_sums(output)

    # Final internal contract: every sidecar points to an existing file and every checksum is valid.
    for sidecar in output.glob("*.sha256"):
        parts = sidecar.read_text(encoding="utf-8").strip().split()
        target = output / Path(parts[-1].lstrip("*")).name
        if not target.is_file() or parts[0] != sha256_file(target):
            raise SystemExit(f"Повреждён final sidecar: {sidecar.name}")
    for raw in (output / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, name = raw.split(None, 1)
        target = output / Path(name.strip().lstrip("*")).name
        if digest != sha256_file(target):
            raise SystemExit(f"SHA256SUMS mismatch: {target.name}")

    print(f"release-assets-ok: {len(list(output.iterdir()))} files; version={version}; targets=1.7,1.8; projects=3")
    return output


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--version", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--managed", default=str(Path(__file__).resolve().parents[1] / "config" / "managed-projects.json"))
    args = parser.parse_args()
    assemble(Path(args.input).resolve(), Path(args.output).resolve(), args.version, args.source_commit, Path(args.managed).resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
