#!/usr/bin/env python3
"""Stream one *.f2re.zip into Project Control without curl or loading it into RAM."""
from __future__ import annotations

import argparse
import http.client
import json
import os
from pathlib import Path
from urllib.parse import urlparse


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("project_id")
    parser.add_argument("package")
    parser.add_argument("--url", default="http://127.0.0.1:9090")
    args = parser.parse_args()

    token = os.environ.get("PROJECT_CONTROL_ACCESS_TOKEN", "")
    if len(token) < 24:
        raise SystemExit("PROJECT_CONTROL_ACCESS_TOKEN не задан")
    package = Path(args.package).resolve()
    if not package.is_file() or not package.name.lower().endswith(".zip"):
        raise SystemExit(f"Не найден Project Control ZIP: {package}")

    parsed = urlparse(args.url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise SystemExit("--url должен быть http(s) URL")
    connection_class = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    connection = connection_class(parsed.hostname, port, timeout=None)
    endpoint = f"/api/projects/{args.project_id}/update"
    connection.putrequest("POST", endpoint)
    connection.putheader("Authorization", f"Bearer {token}")
    connection.putheader("Content-Type", "application/octet-stream")
    connection.putheader("Content-Length", str(package.stat().st_size))
    connection.putheader("X-File-Name", package.name)
    connection.endheaders()
    with package.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            connection.send(chunk)
    response = connection.getresponse()
    body = response.read().decode("utf-8", errors="replace")
    try:
        payload = json.loads(body or "{}")
    except json.JSONDecodeError:
        payload = {"raw": body}
    if response.status < 200 or response.status >= 300:
        raise SystemExit(f"Project Control HTTP {response.status}: {payload}")
    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
