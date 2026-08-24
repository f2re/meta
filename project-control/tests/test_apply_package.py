import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class ApplyPackageHandler(BaseHTTPRequestHandler):
    chunks = []
    seen_paths = []
    prefix = "/proxy/project-control"
    upload_id = "123e4567-e89b-42d3-a456-426614174000"

    def log_message(self, *_args):
        pass

    def _json(self, status, payload):
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _body(self):
        size = int(self.headers.get("Content-Length", "0"))
        return self.rfile.read(size) if size else b""

    def do_POST(self):
        type(self).seen_paths.append(self.path)
        if self.path == f"{self.prefix}/api/uploads/start":
            request = json.loads(self._body().decode("utf-8"))
            self.assert_header_token()
            if request["projectId"] != "docomator" or request["size"] != 10:
                return self._json(400, {"error": "bad start"})
            return self._json(201, {"uploadId": self.upload_id, "chunkBytes": 4})
        if self.path == f"{self.prefix}/api/uploads/{self.upload_id}/complete":
            self.assert_header_token()
            return self._json(202, {"jobId": self.upload_id, "status": "queued"})
        return self._json(404, {"error": "not found"})

    def do_PUT(self):
        type(self).seen_paths.append(self.path)
        if self.path == f"{self.prefix}/api/uploads/{self.upload_id}/chunk":
            self.assert_header_token()
            type(self).chunks.append((int(self.headers["X-Chunk-Index"]), self._body()))
            return self._json(200, {"complete": sum(len(item[1]) for item in self.chunks) == 10})
        return self._json(404, {"error": "not found"})

    def do_GET(self):
        type(self).seen_paths.append(self.path)
        if self.path == f"{self.prefix}/api/jobs/{self.upload_id}":
            self.assert_header_token()
            return self._json(200, {"status": "success", "result": {"project": {"version": "test"}}})
        return self._json(404, {"error": "not found"})

    def do_DELETE(self):
        type(self).seen_paths.append(self.path)
        return self._json(200, {"ok": True})

    def assert_header_token(self):
        if self.headers.get("Authorization") != "Bearer " + ("x" * 32):
            raise AssertionError("missing bearer token")


class ApplyPackageTests(unittest.TestCase):
    def setUp(self):
        ApplyPackageHandler.chunks = []
        ApplyPackageHandler.seen_paths = []
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ApplyPackageHandler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_chunked_upload_and_prefix(self):
        root = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            package = Path(tmp) / "docomator-test.f2re.zip"
            package.write_bytes(b"abcdefghij")
            env = dict(os.environ)
            env["PROJECT_CONTROL_ACCESS_TOKEN"] = "x" * 32
            result = subprocess.run(
                [
                    os.environ.get("PYTHON", "python3"),
                    str(root / "scripts" / "apply-package.py"),
                    "docomator",
                    str(package),
                    "--url",
                    f"http://127.0.0.1:{self.server.server_port}/proxy/project-control/",
                    "--poll-interval",
                    "0.01",
                    "--timeout",
                    "2",
                ],
                env=env,
                text=True,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=10,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(ApplyPackageHandler.chunks, [(0, b"abcd"), (1, b"efgh"), (2, b"ij")])
        self.assertIn("/proxy/project-control/api/uploads/start", ApplyPackageHandler.seen_paths)
        self.assertIn(f"/proxy/project-control/api/jobs/{ApplyPackageHandler.upload_id}", ApplyPackageHandler.seen_paths)
        self.assertIn('"version": "test"', result.stdout)


if __name__ == "__main__":
    unittest.main()
