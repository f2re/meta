#!/usr/bin/env python3
"""Safe inspection/extraction for Project Control packages and native bundles."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import tarfile
import zipfile

MAX_MANIFEST_BYTES = 128 * 1024
MAX_FILES = 50_000
MAX_EXPANDED_BYTES = 20 * 1024 * 1024 * 1024
MAX_SINGLE_FILE_BYTES = 12 * 1024 * 1024 * 1024
SCHEMA = "f2re-managed-service/v1"


class PackageError(RuntimeError):
    pass


def sha256_stream(stream):
    digest = hashlib.sha256()
    size = 0
    for chunk in iter(lambda: stream.read(1024 * 1024), b""):
        size += len(chunk)
        digest.update(chunk)
    return digest.hexdigest(), size


def safe_member_path(name: str) -> PurePosixPath:
    if not name or "\\" in name or any(ord(char) < 32 for char in name):
        raise PackageError(f"Небезопасное имя в архиве: {name!r}")
    value = PurePosixPath(name)
    if value.is_absolute() or any(part in ("", ".", "..") for part in value.parts):
        raise PackageError(f"Небезопасный путь в архиве: {name}")
    return value


def wrapper_info(package_path: Path) -> dict:
    if not zipfile.is_zipfile(package_path):
        raise PackageError("Project Control package должен быть ZIP-контейнером.")
    with zipfile.ZipFile(package_path) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_FILES:
            raise PackageError("Слишком много файлов в Project Control package.")
        names = set()
        for info in infos:
            member = safe_member_path(info.filename.rstrip("/")) if info.filename.endswith("/") else safe_member_path(info.filename)
            normalized = member.as_posix()
            if normalized in names:
                raise PackageError(f"Повтор пути в ZIP: {normalized}")
            names.add(normalized)
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if unix_mode and stat.S_ISLNK(unix_mode):
                raise PackageError(f"Симлинки запрещены: {normalized}")
            if info.flag_bits & 0x1:
                raise PackageError("Зашифрованные ZIP entries не поддерживаются.")
        try:
            manifest_info = archive.getinfo("f2re-service.json")
        except KeyError as exc:
            raise PackageError("В ZIP отсутствует f2re-service.json.") from exc
        if manifest_info.file_size > MAX_MANIFEST_BYTES:
            raise PackageError("f2re-service.json слишком велик.")
        raw_manifest = archive.read(manifest_info)
        try:
            manifest = json.loads(raw_manifest.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise PackageError("Некорректный f2re-service.json.") from exc
        if not isinstance(manifest, dict) or manifest.get("schema") != SCHEMA:
            raise PackageError("Неподдерживаемая схема Project Control package.")
        payload = manifest.get("payload")
        if not isinstance(payload, dict):
            raise PackageError("В manifest отсутствует payload.")
        payload_path = payload.get("path")
        payload_sha = payload.get("sha256")
        payload_size = payload.get("size")
        if not isinstance(payload_path, str):
            raise PackageError("Некорректный payload.path.")
        safe_member_path(payload_path)
        if not payload_path.startswith("payload/"):
            raise PackageError("payload.path должен находиться внутри payload/.")
        if not isinstance(payload_sha, str) or len(payload_sha) != 64 or any(ch not in "0123456789abcdef" for ch in payload_sha):
            raise PackageError("Некорректный payload.sha256.")
        if not isinstance(payload_size, int) or payload_size < 1 or payload_size > MAX_SINGLE_FILE_BYTES:
            raise PackageError("Некорректный payload.size.")
        try:
            payload_info = archive.getinfo(payload_path)
        except KeyError as exc:
            raise PackageError("Payload, указанный в manifest, отсутствует.") from exc
        if payload_info.file_size != payload_size:
            raise PackageError("Размер payload не совпадает с manifest.")
        allowed = {"f2re-service.json", payload_path}
        signature_raw = None
        if "f2re-service.sig" in names:
            allowed.add("f2re-service.sig")
            signature_text = archive.read("f2re-service.sig")
            if len(signature_text) > 16 * 1024:
                raise PackageError("Файл подписи слишком велик.")
            try:
                signature_raw = base64.b64decode(signature_text.strip(), validate=True)
            except ValueError as exc:
                raise PackageError("Некорректный f2re-service.sig.") from exc
        actual_files = {name for name in names if not name.endswith("/")}
        unexpected = actual_files - allowed
        if unexpected:
            raise PackageError("ZIP содержит неожиданные файлы: " + ", ".join(sorted(unexpected)[:5]))
        return {
            "manifest": manifest,
            "rawManifestBase64": base64.b64encode(raw_manifest).decode("ascii"),
            "signatureBase64": base64.b64encode(signature_raw).decode("ascii") if signature_raw is not None else None,
            "payloadPath": payload_path,
        }


def extract_wrapper_payload(package_path: Path, destination: Path) -> Path:
    info = wrapper_info(package_path)
    manifest = info["manifest"]
    payload = manifest["payload"]
    destination.mkdir(parents=True, exist_ok=True)
    output = destination / Path(payload["path"]).name
    if output.exists():
        raise PackageError(f"Файл уже существует: {output}")
    with zipfile.ZipFile(package_path) as archive, archive.open(payload["path"], "r") as source, output.open("xb") as target:
        digest = hashlib.sha256()
        size = 0
        while True:
            chunk = source.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX_SINGLE_FILE_BYTES:
                raise PackageError("Payload превышает допустимый размер.")
            digest.update(chunk)
            target.write(chunk)
    if size != payload["size"] or digest.hexdigest() != payload["sha256"]:
        try:
            output.unlink()
        except FileNotFoundError:
            pass
        raise PackageError("SHA-256 или размер payload не совпадает с manifest.")
    return output


def ensure_output_path(destination: Path, relative: PurePosixPath) -> Path:
    candidate = destination.joinpath(*relative.parts)
    destination_resolved = destination.resolve()
    parent = candidate.parent
    parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    parent_resolved = parent.resolve()
    try:
        parent_resolved.relative_to(destination_resolved)
    except ValueError as exc:
        raise PackageError(f"Выход за staging-каталог: {relative}") from exc
    return candidate


def normalized_file_mode(raw_mode: int) -> int:
    return 0o755 if raw_mode & 0o111 else 0o644


def extract_native_zip(archive_path: Path, destination: Path) -> None:
    seen = set()
    count = 0
    expanded = 0
    with zipfile.ZipFile(archive_path) as archive:
        for info in archive.infolist():
            name = info.filename.rstrip("/") if info.filename.endswith("/") else info.filename
            relative = safe_member_path(name)
            normalized = relative.as_posix()
            if normalized in seen:
                raise PackageError(f"Повтор пути в ZIP: {normalized}")
            seen.add(normalized)
            count += 1
            if count > MAX_FILES:
                raise PackageError("Архив содержит слишком много entries.")
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if unix_mode and stat.S_ISLNK(unix_mode):
                raise PackageError(f"Симлинки запрещены: {normalized}")
            if info.flag_bits & 0x1:
                raise PackageError("Зашифрованные ZIP entries не поддерживаются.")
            target = destination.joinpath(*relative.parts)
            if info.is_dir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
                continue
            if info.file_size > MAX_SINGLE_FILE_BYTES:
                raise PackageError(f"Слишком большой файл: {normalized}")
            expanded += info.file_size
            if expanded > MAX_EXPANDED_BYTES:
                raise PackageError("Распакованный архив превышает допустимый объём.")
            target = ensure_output_path(destination, relative)
            mode = normalized_file_mode(unix_mode)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
            with os.fdopen(fd, "wb") as output, archive.open(info, "r") as source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            os.chmod(target, mode)


def extract_native_tar(archive_path: Path, destination: Path) -> None:
    seen = set()
    count = 0
    expanded = 0
    with tarfile.open(archive_path, mode="r:*") as archive:
        for member in archive:
            relative = safe_member_path(member.name.rstrip("/") if member.isdir() else member.name)
            normalized = relative.as_posix()
            if normalized in seen:
                raise PackageError(f"Повтор пути в TAR: {normalized}")
            seen.add(normalized)
            count += 1
            if count > MAX_FILES:
                raise PackageError("Архив содержит слишком много entries.")
            target = destination.joinpath(*relative.parts)
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True, mode=0o755)
                continue
            if not member.isfile():
                raise PackageError(f"Разрешены только файлы и каталоги: {normalized}")
            if member.size > MAX_SINGLE_FILE_BYTES:
                raise PackageError(f"Слишком большой файл: {normalized}")
            expanded += member.size
            if expanded > MAX_EXPANDED_BYTES:
                raise PackageError("Распакованный архив превышает допустимый объём.")
            source = archive.extractfile(member)
            if source is None:
                raise PackageError(f"Не удалось прочитать файл: {normalized}")
            target = ensure_output_path(destination, relative)
            mode = normalized_file_mode(member.mode)
            fd = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), mode)
            with os.fdopen(fd, "wb") as output, source:
                shutil.copyfileobj(source, output, length=1024 * 1024)
            os.chmod(target, mode)


def extract_native(archive_path: Path, destination: Path) -> None:
    destination.mkdir(parents=True, exist_ok=False, mode=0o750)
    if zipfile.is_zipfile(archive_path):
        extract_native_zip(archive_path, destination)
    elif tarfile.is_tarfile(archive_path):
        extract_native_tar(archive_path, destination)
    else:
        raise PackageError("Неподдерживаемый native bundle: ожидается TAR/TAR.GZ/TGZ/ZIP.")


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    inspect_parser = subparsers.add_parser("inspect")
    inspect_parser.add_argument("package")
    payload_parser = subparsers.add_parser("extract-payload")
    payload_parser.add_argument("package")
    payload_parser.add_argument("destination")
    native_parser = subparsers.add_parser("extract-native")
    native_parser.add_argument("archive")
    native_parser.add_argument("destination")
    args = parser.parse_args()
    try:
        if args.command == "inspect":
            print(json.dumps(wrapper_info(Path(args.package)), ensure_ascii=False))
        elif args.command == "extract-payload":
            print(extract_wrapper_payload(Path(args.package), Path(args.destination)))
        elif args.command == "extract-native":
            extract_native(Path(args.archive), Path(args.destination))
            print(Path(args.destination))
        return 0
    except PackageError as error:
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
