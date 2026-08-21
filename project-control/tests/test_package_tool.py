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
TOOL = ROOT / "src" / "package_tool.py"


class PackageToolTests(unittest.TestCase):
    def run_tool(self, *args, ok=True):
        result = subprocess.run([sys.executable, str(TOOL), *map(str, args)], text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        if ok and result.returncode != 0:
            self.fail(result.stderr)
        if not ok and result.returncode == 0:
            self.fail("command unexpectedly succeeded")
        return result

    def create_native_tar(self, directory):
        source = directory / "native-root"
        source.mkdir()
        script = source / "install.sh"
        script.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
        script.chmod(0o755)
        archive = directory / "native.tar.gz"
        with tarfile.open(archive, "w:gz") as tar:
            tar.add(source, arcname="native-root")
        return archive

    def create_wrapper(self, directory, native):
        digest = hashlib.sha256(native.read_bytes()).hexdigest()
        manifest = {
            "schema": "f2re-managed-service/v1",
            "controllerApi": 1,
            "projectId": "kafedra-planner",
            "displayName": "Кафедра Planner",
            "adapter": "kafedra-planner-v1",
            "version": "0.1.0",
            "sourceCommit": "unknown",
            "nativeBundleFormat": "test",
            "signing": None,
            "payload": {"path": "payload/native.tar.gz", "sha256": digest, "size": native.stat().st_size},
        }
        package = directory / "release.f2re.zip"
        with zipfile.ZipFile(package, "w", compression=zipfile.ZIP_STORED) as zip_file:
            zip_file.writestr("f2re-service.json", json.dumps(manifest).encode())
            zip_file.write(native, "payload/native.tar.gz")
        return package

    def test_inspect_and_extract_payload(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            native = self.create_native_tar(root)
            package = self.create_wrapper(root, native)
            info = json.loads(self.run_tool("inspect", package).stdout)
            self.assertEqual(info["manifest"]["projectId"], "kafedra-planner")
            payload_dir = root / "payload-out"
            payload = Path(self.run_tool("extract-payload", package, payload_dir).stdout.strip())
            self.assertEqual(hashlib.sha256(payload.read_bytes()).hexdigest(), hashlib.sha256(native.read_bytes()).hexdigest())
            native_out = root / "native-out"
            self.run_tool("extract-native", payload, native_out)
            self.assertTrue((native_out / "native-root" / "install.sh").is_file())

    def test_rejects_unexpected_wrapper_file(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            native = self.create_native_tar(root)
            package = self.create_wrapper(root, native)
            rewritten = root / "bad.zip"
            with zipfile.ZipFile(package) as source, zipfile.ZipFile(rewritten, "w") as target:
                for info in source.infolist():
                    target.writestr(info.filename, source.read(info.filename))
                target.writestr("run-me.sh", "echo bad")
            self.run_tool("inspect", rewritten, ok=False)

    def test_rejects_tar_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            archive = root / "bad.tar.gz"
            payload = root / "payload.txt"
            payload.write_text("bad", encoding="utf-8")
            with tarfile.open(archive, "w:gz") as tar:
                info = tar.gettarinfo(str(payload), arcname="../escape.txt")
                with payload.open("rb") as stream:
                    tar.addfile(info, stream)
            self.run_tool("extract-native", archive, root / "out", ok=False)
            self.assertFalse((root / "escape.txt").exists())


if __name__ == "__main__":
    unittest.main()
