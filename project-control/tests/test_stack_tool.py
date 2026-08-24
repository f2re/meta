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
TOOL = ROOT / "scripts" / "stack_tool.py"
MANAGED = ROOT / "config" / "managed-projects.json"
META_COMMIT = "a" * 40


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sidecar(path: Path):
    Path(f"{path}.sha256").write_text(f"{sha256(path)}  {path.name}\n", encoding="utf-8")


class StackToolTests(unittest.TestCase):
    def create_meta(self, root: Path, managed: dict) -> Path:
        source = root / "meta-root"
        source.mkdir()
        (source / "meta-release.json").write_text(json.dumps({
            "schema": "f2re-meta-bundle/v1",
            "version": "0.3.0",
            "sourceCommit": META_COMMIT,
            "target": {"os": "astra-linux-special-edition", "version": "1.8", "architecture": "amd64"},
        }), encoding="utf-8")
        (source / "managed-projects.json").write_text(json.dumps(managed, ensure_ascii=False), encoding="utf-8")
        for name in ("verify.sh", "install.sh"):
            target = source / name
            target.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
            target.chmod(0o755)
        archive = root / "f2re-meta-0.3.0-astra-1.8-amd64.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(source, arcname="f2re-meta-0.3.0-astra-1.8-amd64")
        sidecar(archive)
        return archive

    def create_project(self, root: Path, project: dict) -> Path:
        payload = f"payload-{project['projectId']}".encode()
        package = root / project["release"]["artifactPattern"].replace("*", "ci")
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
        return package

    def test_verify_pack_and_dry_run(self):
        managed = json.loads(MANAGED.read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as temp:
            temp_root = Path(temp)
            inputs = temp_root / "inputs"
            output = temp_root / "output"
            inputs.mkdir()
            self.create_meta(inputs, managed)
            for project in managed["projects"]:
                self.create_project(inputs, project)

            subprocess.run([sys.executable, TOOL, "verify-inputs", inputs, MANAGED, "--meta-commit", META_COMMIT], check=True)
            result = subprocess.run([
                sys.executable, TOOL, "pack", inputs, MANAGED, output,
                "--version", "0.3.0", "--meta-commit", META_COMMIT,
            ], check=True, text=True, stdout=subprocess.PIPE)
            bundle = Path(result.stdout.strip().splitlines()[-1])
            self.assertTrue(bundle.is_file())
            self.assertTrue(Path(f"{bundle}.sha256").is_file())

            extracted = temp_root / "extracted"
            extracted.mkdir()
            with tarfile.open(bundle, "r:gz") as archive:
                archive.extractall(extracted, filter="data")
            roots = [path for path in extracted.iterdir() if path.is_dir()]
            self.assertEqual(len(roots), 1)
            stack_root = roots[0]
            subprocess.run([sys.executable, stack_root / "stack_tool.py", "verify-bundle", stack_root], check=True)
            dry = subprocess.run([stack_root / "deploy-stack.sh", "--dry-run"], check=True, text=True, stdout=subprocess.PIPE)
            self.assertIn("Dry-run: изменений не внесено", dry.stdout)
            release = json.loads((stack_root / "stack-release.json").read_text(encoding="utf-8"))
            self.assertEqual([p["projectId"] for p in release["projects"]], ["docomator", "planer-solving", "kafedra-planner"])


if __name__ == "__main__":
    unittest.main()
