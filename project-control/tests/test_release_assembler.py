import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ASSEMBLER = ROOT / "scripts" / "assemble-github-release.py"
MANAGED = ROOT / "config" / "managed-projects.json"
VERSION = "0.6.0"
COMMIT = "b" * 40


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sidecar(path: Path):
    Path(f"{path}.sha256").write_text(f"{sha256(path)}  {path.name}\n", encoding="utf-8")


def create_meta(root: Path, managed: dict, astra: str):
    source = root / f"meta-root-{astra}"
    source.mkdir()
    (source / "meta-release.json").write_text(json.dumps({
        "schema": "f2re-meta-bundle/v1",
        "version": VERSION,
        "sourceCommit": COMMIT,
        "target": {"os": "astra-linux-special-edition", "version": astra, "architecture": "amd64"},
    }), encoding="utf-8")
    (source / "managed-projects.json").write_text(json.dumps(managed, ensure_ascii=False), encoding="utf-8")
    for name in ("verify.sh", "install.sh"):
        path = source / name
        path.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        path.chmod(0o755)
    archive = root / f"f2re-meta-{VERSION}-astra-{astra}-amd64.tar.gz"
    with tarfile.open(archive, "w:gz") as tar:
        tar.add(source, arcname=f"f2re-meta-{VERSION}-astra-{astra}-amd64")
    sidecar(archive)


def create_project(root: Path, project: dict):
    payload = f"payload-{project['projectId']}".encode()
    package = root / project["release"]["artifactPattern"].replace("*", "9.9.9-ci")
    manifest = {
        "schema": "f2re-managed-service/v1",
        "controllerApi": 1,
        "projectId": project["projectId"],
        "displayName": project["displayName"],
        "adapter": project["adapter"],
        "version": "9.9.9-ci",
        "sourceCommit": project["verifiedCommit"],
        "nativeBundleFormat": project["nativeBundleFormat"],
        "signing": None,
        "payload": {"path": "payload/native.tar.gz", "sha256": hashlib.sha256(payload).hexdigest(), "size": len(payload)},
    }
    with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_STORED) as archive:
        archive.writestr("f2re-service.json", json.dumps(manifest).encode())
        archive.writestr("payload/native.tar.gz", payload)
    sidecar(package)


class ReleaseAssemblerTests(unittest.TestCase):
    def test_complete_release_assets(self):
        managed = json.loads(MANAGED.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temp:
            work = Path(temp)
            inputs = work / "inputs"
            output = work / "release"
            inputs.mkdir()

            controller = inputs / f"project-control-{VERSION}-linux-x64.tar.gz"
            controller.write_bytes(b"controller")
            sidecar(controller)
            installer = inputs / "install-project-control.sh"
            installer.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            installer.chmod(0o755)

            for astra in ("1.7", "1.8"):
                create_meta(inputs, managed, astra)
            for project in managed["projects"]:
                create_project(inputs, project)

            result = subprocess.run([
                sys.executable, ASSEMBLER,
                "--input", inputs,
                "--output", output,
                "--version", VERSION,
                "--source-commit", COMMIT,
                "--managed", MANAGED,
            ], check=True, text=True, stdout=subprocess.PIPE)
            self.assertIn("release-assets-ok", result.stdout)

            names = {path.name for path in output.iterdir() if path.is_file()}
            self.assertEqual(len(names), 39)
            for astra in ("1.7", "1.8"):
                self.assertIn(f"f2re-meta-{VERSION}-astra-{astra}-amd64.tar.gz", names)
                self.assertIn(f"f2re-meta-astra-{astra}-amd64.tar.gz", names)
                self.assertIn(f"f2re-stack-{VERSION}-astra-{astra}-amd64.tar.gz", names)
                self.assertIn(f"f2re-stack-astra-{astra}-amd64.tar.gz", names)
            for project in managed["projects"]:
                self.assertIn(f"{project['projectId']}-project-control.f2re.zip", names)

            manifest = json.loads((output / "release-manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["schema"], "f2re-github-release/v2")
            self.assertEqual(manifest["version"], VERSION)
            self.assertEqual(manifest["sourceCommit"], COMMIT)
            self.assertEqual(len(manifest["managedProjects"]), 3)
            self.assertEqual(len(manifest["assets"]), 19)
            self.assertEqual({x["version"] for x in manifest["targets"]}, {"1.7", "1.8"})

            sums = (output / "SHA256SUMS").read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(sums), 38)


if __name__ == "__main__":
    unittest.main()
