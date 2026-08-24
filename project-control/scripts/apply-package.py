#!/usr/bin/env python3
"""Upload one *.f2re.zip through Project Control chunked API without loading it into RAM."""
from __future__ import annotations

import argparse
import http.client
import json
import os
from pathlib import Path
import time
from urllib.parse import urlparse


def api_path(parsed, relative: str) -> str:
    prefix = (parsed.path or "").rstrip("/")
    suffix = "/" + relative.lstrip("/")
    return f"{prefix}{suffix}" if prefix else suffix


def request_json(parsed, token: str, method: str, relative: str, *, body: bytes | None = None, headers: dict[str, str] | None = None, timeout: float = 30.0):
    connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    connection = connection_class(parsed.hostname, port, timeout=timeout)
    payload = body if body is not None else b""
    request_headers = {"Authorization": f"Bearer {token}", **(headers or {})}
    if body is not None:
        request_headers["Content-Length"] = str(len(payload))
    try:
        connection.request(method, api_path(parsed, relative), body=payload if body is not None else None, headers=request_headers)
        response = connection.getresponse()
        text = response.read().decode("utf-8", errors="replace")
    finally:
        connection.close()
    try:
        data = json.loads(text or "{}")
    except json.JSONDecodeError:
        data = {"raw": text}
    if response.status < 200 or response.status >= 300:
        raise RuntimeError(f"Project Control HTTP {response.status}: {data}")
    return data


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_id")
    parser.add_argument("package")
    parser.add_argument("--url", default="http://127.0.0.1:9090")
    parser.add_argument("--poll-interval", type=float, default=2.0)
    parser.add_argument("--timeout", type=float, default=1800.0)
    args = parser.parse_args()

    token = os.environ.get("PROJECT_CONTROL_ACCESS_TOKEN", "")
    if len(token) < 24:
        raise SystemExit("PROJECT_CONTROL_ACCESS_TOKEN не задан")
    package = Path(args.package).resolve()
    if not package.is_file() or not package.name.lower().endswith(".zip"):
        raise SystemExit(f"Не найден Project Control ZIP: {package}")

    parsed = urlparse(args.url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.query or parsed.fragment:
        raise SystemExit("--url должен быть http(s) URL без query/fragment")
    if args.poll_interval <= 0 or args.timeout <= 0:
        raise SystemExit("--poll-interval и --timeout должны быть положительными")

    upload_id = None
    completed = False
    try:
        start_body = json.dumps(
            {"projectId": args.project_id, "fileName": package.name, "size": package.stat().st_size},
            ensure_ascii=False,
        ).encode("utf-8")
        start = request_json(
            parsed,
            token,
            "POST",
            "/api/uploads/start",
            body=start_body,
            headers={"Content-Type": "application/json"},
        )
        upload_id = str(start.get("uploadId") or "")
        chunk_bytes = int(start.get("chunkBytes") or 512 * 1024)
        if not upload_id or chunk_bytes < 1:
            raise RuntimeError(f"Project Control вернул некорректные параметры загрузки: {start}")

        sent = 0
        index = 0
        total = package.stat().st_size
        with package.open("rb") as stream:
            while True:
                chunk = stream.read(chunk_bytes)
                if not chunk:
                    break
                request_json(
                    parsed,
                    token,
                    "PUT",
                    f"/api/uploads/{upload_id}/chunk",
                    body=chunk,
                    headers={"Content-Type": "application/octet-stream", "X-Chunk-Index": str(index)},
                    timeout=60.0,
                )
                sent += len(chunk)
                index += 1
                print(f"upload: {sent}/{total} bytes ({round(sent * 100 / total)}%)", flush=True)

        queued = request_json(parsed, token, "POST", f"/api/uploads/{upload_id}/complete")
        completed = True
        job_id = str(queued.get("jobId") or "")
        if not job_id:
            raise RuntimeError(f"Project Control не вернул jobId: {queued}")

        deadline = time.monotonic() + args.timeout
        while time.monotonic() < deadline:
            job = request_json(parsed, token, "GET", f"/api/jobs/{job_id}")
            status = job.get("status")
            if status == "success":
                print(json.dumps(job.get("result") or {}, ensure_ascii=False))
                return 0
            if status == "failed":
                raise RuntimeError(job.get("error") or "Установка завершилась ошибкой")
            time.sleep(args.poll_interval)
        raise RuntimeError(f"Превышено время ожидания операции {job_id}")
    except Exception as exc:
        if upload_id and not completed:
            try:
                request_json(parsed, token, "DELETE", f"/api/uploads/{upload_id}")
            except Exception:
                pass
        raise SystemExit(str(exc)) from exc


if __name__ == "__main__":
    raise SystemExit(main())
