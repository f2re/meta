#!/usr/bin/env bash
set -Eeuo pipefail

META_ROOT="${1:-}"
[[ -n "$META_ROOT" && -d "$META_ROOT" ]] || { echo "Usage: $0 <extracted-meta-root>" >&2; exit 2; }
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "CI install smoke must run as root" >&2; exit 2; }
for cmd in bash python3 sha256sum tar useradd groupadd getent runuser; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда для deployment smoke: $cmd" >&2; exit 2; }
done

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
          nohup /opt/project-control/current/runtime/node/bin/node \
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
assert payload == {"ok": True, "version": sys.argv[2]}, payload
PY

TOKEN="$(awk -F= '$1=="PROJECT_CONTROL_ACCESS_TOKEN"{sub(/^[^=]*=/, ""); print; exit}' /etc/project-control/project-control.env)"
[[ ${#TOKEN} -ge 24 ]]

/opt/project-control/current/runtime/node/bin/node - "$TOKEN" <<'NODE'
const http = require('node:http');
const token = process.argv[2];
function get(path, headers={}) {
  return new Promise((resolve,reject)=>{
    const req=http.get({host:'127.0.0.1',port:9090,path,headers,timeout:3000},res=>{
      let body=''; res.setEncoding('utf8'); res.on('data',c=>body+=c);
      res.on('end',()=>resolve({status:res.statusCode,body}));
    });
    req.on('error',reject); req.on('timeout',()=>{req.destroy();reject(new Error('timeout'))});
  });
}
(async () => {
  const ui = await get('/');
  if (ui.status !== 200 || !ui.body.includes('Project Control')) throw new Error(`UI smoke failed: ${ui.status}`);
  const projects = await get('/api/projects', {Authorization:`Bearer ${token}`});
  if (projects.status !== 200) throw new Error(`API projects failed: ${projects.status} ${projects.body}`);
  const payload = JSON.parse(projects.body);
  const ids = payload.projects.map(p=>p.id).sort().join(',');
  if (ids !== 'docomator,kafedra-planner,planer-solving') throw new Error(`unexpected project ids: ${ids}`);
  console.log('ui-api-ipc-ok: / and authenticated /api/projects');
})().catch((error) => { console.error(error); process.exit(1); });
NODE

kill -0 "$(cat "$STATE/executor.pid")"
kill -0 "$(cat "$STATE/web.pid")"
echo "deployment-smoke-ok: Project Control $VERSION installed; UI, executor IPC and /api/ping are live"
