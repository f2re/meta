#!/usr/bin/env bash
set -Eeuo pipefail

META_ROOT="${1:-}"
EXPECTED_ASTRA_VERSION="${2:-}"
[[ -n "$META_ROOT" && -d "$META_ROOT" ]] || { echo "Usage: $0 <extracted-meta-root> [1.7|1.8]" >&2; exit 2; }
[[ -z "$EXPECTED_ASTRA_VERSION" || "$EXPECTED_ASTRA_VERSION" == "1.7" || "$EXPECTED_ASTRA_VERSION" == "1.8" ]] || { echo "Expected Astra version must be 1.7 or 1.8" >&2; exit 2; }
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "CI install smoke must run as root" >&2; exit 2; }
for cmd in bash python3 sha256sum tar useradd groupadd getent runuser; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда для deployment smoke: $cmd" >&2; exit 2; }
done

if [[ -n "$EXPECTED_ASTRA_VERSION" ]]; then
  python3 - "$META_ROOT/meta-release.json" "$EXPECTED_ASTRA_VERSION" <<'PY'
import json, sys
from pathlib import Path
release = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
actual = str(release["target"]["version"])
expected = sys.argv[2]
assert actual == expected or actual.startswith(expected + "."), (actual, expected)
print(f"target-ok: Astra Linux {actual}")
PY
fi

STATE="$(mktemp -d)"
FAKE_BIN="$STATE/bin"
mkdir -p "$FAKE_BIN"
cleanup() {
  set +e
  for name in web executor; do
    pidfile="$STATE/$name.pid"
    if [[ -f "$pidfile" ]]; then
      pid="$(cat "$pidfile")"
      kill "$pid" >/dev/null 2>&1 || true
      for _ in $(seq 1 20); do kill -0 "$pid" >/dev/null 2>&1 || break; sleep 0.1; done
      kill -9 "$pid" >/dev/null 2>&1 || true
    fi
  done
  rm -rf "$STATE"
}
trap cleanup EXIT

cat > "$FAKE_BIN/systemctl" <<'EOF_SYSTEMCTL'
#!/usr/bin/env bash
set -Eeuo pipefail
STATE="${PROJECT_CONTROL_CI_STATE:?}"
verb="${1:-}"; shift || true
load_env() {
  [[ -f /etc/project-control/project-control.env ]] || return 0
  set -a
  . /etc/project-control/project-control.env
  set +a
}
stop_one() {
  local file="$1"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    kill "$pid" >/dev/null 2>&1 || true
    rm -f "$file"
  fi
}
case "$verb" in
  daemon-reload|enable|disable)
    exit 0
    ;;
  restart|start)
    load_env
    for service in "$@"; do
      case "$service" in
        project-control-executor.service)
          stop_one "$STATE/executor.pid"
          mkdir -p /run/project-control
          nohup runuser -u root -g project-control -- /opt/project-control/current/runtime/node/bin/node \
            /opt/project-control/current/src/executor.mjs >"$STATE/executor.log" 2>&1 &
          echo $! > "$STATE/executor.pid"
          ;;
        project-control.service)
          stop_one "$STATE/web.pid"
          nohup runuser -u project-control -- \
            /opt/project-control/current/runtime/node/bin/node \
            /opt/project-control/current/src/server.mjs >"$STATE/web.log" 2>&1 &
          echo $! > "$STATE/web.pid"
          ;;
        *) exit 0 ;;
      esac
    done
    ;;
  stop)
    for service in "$@"; do
      case "$service" in
        project-control-executor.service) stop_one "$STATE/executor.pid" ;;
        project-control.service) stop_one "$STATE/web.pid" ;;
      esac
    done
    ;;
  is-active|is-enabled)
    exit 0
    ;;
  *)
    echo "CI systemctl shim: unsupported verb $verb" >&2
    exit 1
    ;;
esac
EOF_SYSTEMCTL
chmod 0755 "$FAKE_BIN/systemctl"

export PROJECT_CONTROL_CI_STATE="$STATE"
export PATH="$FAKE_BIN:$PATH"

"$META_ROOT/verify.sh"
"$META_ROOT/install.sh"

[[ -L /opt/project-control/current ]]
[[ -r /opt/project-control/current/VERSION ]]
VERSION="$(tr -d '[:space:]' < /opt/project-control/current/VERSION)"
[[ -f /etc/project-control/project-control.env ]]
[[ -f /root/project-control-access.txt ]]
[[ -S /run/project-control/executor.sock ]]

PING="$(/opt/project-control/current/runtime/node/bin/node - <<'NODE'
const http = require('node:http');
const req = http.get({host:'127.0.0.1', port:9090, path:'/api/ping', timeout:2000}, (res) => {
  let body=''; res.setEncoding('utf8'); res.on('data', c => body += c);
  res.on('end', () => { if (res.statusCode !== 200) process.exit(2); process.stdout.write(body); });
});
req.on('error', e => { console.error(e.message); process.exit(3); });
req.on('timeout', () => { req.destroy(); process.exit(4); });
NODE
)"
python3 - "$PING" "$VERSION" <<'PY'
import json, sys
payload = json.loads(sys.argv[1])
assert payload["ok"] is True, payload
assert payload["version"] == sys.argv[2], payload
assert payload["discovery"] is True, payload
assert payload["chunkedUpload"] is True, payload
assert payload["asyncJobs"] is True, payload
PY

TOKEN="$(awk -F= '$1=="PROJECT_CONTROL_ACCESS_TOKEN"{sub(/^[^=]*=/, ""); print; exit}' /etc/project-control/project-control.env)"
[[ "$TOKEN" =~ ^[0-9]{4}$ ]]
[[ "$(stat -c '%a:%U:%G' /run/project-control/executor.sock)" == "660:root:project-control" ]]

/opt/project-control/current/runtime/node/bin/node - "$TOKEN" <<'NODE'
const http = require('node:http');
const token = process.argv[2];
function request(path, {method='GET', headers={}, body=null}={}) {
  return new Promise((resolve,reject)=>{
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body);
    const req=http.request({
      host:'127.0.0.1',port:9090,path,method,
      headers:{...headers,...(payload?{'content-length':payload.length}:{})},timeout:5000
    },res=>{
      let responseBody=''; res.setEncoding('utf8'); res.on('data',c=>responseBody+=c);
      res.on('end',()=>resolve({status:res.statusCode,body:responseBody,headers:res.headers}));
    });
    req.on('error',reject); req.on('timeout',()=>{req.destroy();reject(new Error('timeout'))});
    if (payload) req.end(payload); else req.end();
  });
}
function json(response) { try { return JSON.parse(response.body || '{}'); } catch { throw new Error(`bad json: ${response.body}`); } }
(async () => {
  const ui = await request('/');
  if (ui.status !== 200 || !ui.body.includes('Project Control') || !ui.body.includes('Пересканировать сервер')) throw new Error(`UI smoke failed: ${ui.status}`);

  const prefixedUi = await request('/proxy/project-control/');
  if (prefixedUi.status !== 200 || !prefixedUi.body.includes('src="app.js"')) throw new Error(`prefixed UI failed: ${prefixedUi.status}`);
  const prefixedJs = await request('/proxy/project-control/app.js');
  if (prefixedJs.status !== 200 || !prefixedJs.body.includes('uploads/start')) throw new Error(`prefixed app.js failed: ${prefixedJs.status}`);
  if (!String(prefixedJs.headers['cache-control'] || '').includes('no-store')) throw new Error('app.js must be no-store');

  const ping = await request('/proxy/project-control/api/ping');
  if (ping.status !== 200 || !json(ping).discovery) throw new Error(`prefixed ping failed: ${ping.status}`);

  const auth = {Authorization:`Bearer ${token}`};
  const projects = await request('/proxy/project-control/api/projects?rescan=1', {headers:auth});
  if (projects.status !== 200) throw new Error(`API projects failed: ${projects.status} ${projects.body}`);
  const payload = json(projects);
  const ids = payload.projects.map(p=>p.id).sort().join(',');
  if (ids !== 'docomator,kafedra-planner,planer-solving') throw new Error(`unexpected project ids: ${ids}`);
  if (!payload.discovery || !Array.isArray(payload.discovery.listeningPorts) || !payload.discovery.nginx || !payload.discovery.opt) throw new Error('discovery payload missing');

  const discovery = await request('/proxy/project-control/api/discovery?rescan=1', {headers:auth});
  if (discovery.status !== 200 || !Array.isArray(json(discovery).projects)) throw new Error(`discovery endpoint failed: ${discovery.status}`);

  const bytes = Buffer.from('abcdef');
  const start = await request('/proxy/project-control/api/uploads/start', {
    method:'POST', headers:{...auth,'content-type':'application/json'},
    body:JSON.stringify({projectId:'docomator',fileName:'smoke.f2re.zip',size:bytes.length})
  });
  if (start.status !== 201) throw new Error(`chunk start failed: ${start.status} ${start.body}`);
  const uploadId = json(start).uploadId;
  const chunk = await request(`/proxy/project-control/api/uploads/${uploadId}/chunk`, {
    method:'PUT', headers:{...auth,'content-type':'application/octet-stream','x-chunk-index':'0'}, body:bytes
  });
  if (chunk.status !== 200 || !json(chunk).complete) throw new Error(`chunk upload failed: ${chunk.status} ${chunk.body}`);
  const abort = await request(`/proxy/project-control/api/uploads/${uploadId}`, {method:'DELETE',headers:auth});
  if (abort.status !== 200) throw new Error(`chunk abort failed: ${abort.status}`);

  console.log('ui-api-discovery-proxy-chunk-ok');
})().catch((error) => { console.error(error); process.exit(1); });
NODE

kill -0 "$(cat "$STATE/executor.pid")"
kill -0 "$(cat "$STATE/web.pid")"
echo "deployment-smoke-ok: Project Control $VERSION installed; proxy-prefix UI, discovery, chunk API, executor IPC and /api/ping are live"
