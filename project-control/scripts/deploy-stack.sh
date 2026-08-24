#!/usr/bin/env bash
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DRY_RUN=false
SKIP_META=false
ONLY_PROJECT=""
BASE_URL="${PROJECT_CONTROL_URL:-http://127.0.0.1:9090}"
KAFEDRA_API_PORT="${F2RE_KAFEDRA_PORT:-8090}"
KAFEDRA_LLM_PORT="${F2RE_KAFEDRA_LLM_PORT:-8091}"

usage() {
  cat <<'EOF'
Использование: sudo ./deploy-stack.sh [опции]

  --dry-run              только проверить архив и показать план
  --skip-meta            не переустанавливать Project Control
  --project ID           обновить только один проект после meta
  --url URL              Project Control URL, включая path prefix при необходимости
  -h, --help             справка

При чистой совместной установке Kafedra Planner автоматически получает API 8090
и локальный LLM 8091, чтобы не конфликтовать с Оформлятором (8080/8081).
Существующая конфигурация никогда не переписывается. Порты можно задать через
F2RE_KAFEDRA_PORT и F2RE_KAFEDRA_LLM_PORT.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --skip-meta) SKIP_META=true; shift ;;
    --project) [[ $# -ge 2 ]] || { echo "--project требует ID" >&2; exit 2; }; ONLY_PROJECT="$2"; shift 2 ;;
    --url) [[ $# -ge 2 ]] || { echo "--url требует URL" >&2; exit 2; }; BASE_URL="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестная опция: $1" >&2; usage >&2; exit 2 ;;
  esac
done

for value in "$KAFEDRA_API_PORT" "$KAFEDRA_LLM_PORT"; do
  [[ "$value" =~ ^[0-9]+$ ]] && ((value >= 1 && value <= 65535)) || { echo "Некорректный co-location port: $value" >&2; exit 2; }
done
[[ "$KAFEDRA_API_PORT" != "$KAFEDRA_LLM_PORT" ]] || { echo "API и LLM Kafedra не могут использовать один порт" >&2; exit 2; }

for cmd in python3 sha256sum tar find chown chmod getent; do command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда: $cmd" >&2; exit 2; }; done
"$DIR/verify.sh"

PLAN="$(python3 - "$DIR/stack-release.json" "$ONLY_PROJECT" "$KAFEDRA_API_PORT" "$KAFEDRA_LLM_PORT" <<'PY'
import json, sys
release=json.load(open(sys.argv[1], encoding='utf-8')); only=sys.argv[2]
print(f"Meta: {release['meta']['version']} ({release['meta']['file']})")
for p in release['projects']:
    if not only or p['projectId']==only:
        suffix = f"; fresh ports API={sys.argv[3]}, LLM={sys.argv[4]}" if p['projectId']=='kafedra-planner' else ''
        print(f"{p['projectId']}: {p['version']} ({p['file']}){suffix}")
if only and only not in {p['projectId'] for p in release['projects']}:
    raise SystemExit(f"Неизвестный projectId: {only}")
PY
)"
printf 'План F2RE Stack:\n%s\n' "$PLAN"
[[ "$DRY_RUN" == false ]] || { echo "Dry-run: изменений не внесено."; exit 0; }
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Развёртывание нужно запускать от root." >&2; exit 2; }

WORK="$(mktemp -d)"
KAFEDRA_CONFIG_PRESEEDED=false
KAFEDRA_CONFIG=/etc/kafedra-planner/kafedra-planner.env
cleanup() {
  status=$?
  trap - EXIT
  if [[ "$status" -ne 0 && "$KAFEDRA_CONFIG_PRESEEDED" == true ]]; then
    echo "Откат: удаляю созданную one-shot конфигурацию Kafedra Planner." >&2
    rm -f "$KAFEDRA_CONFIG"
  fi
  rm -rf "$WORK"
  exit "$status"
}
trap cleanup EXIT

if [[ "$SKIP_META" == false ]]; then
  META_FILE="$(python3 - "$DIR/stack-release.json" <<'PY'
import json,sys
print(json.load(open(sys.argv[1],encoding='utf-8'))['meta']['file'])
PY
)"
  META_ARCHIVE="$DIR/meta/$META_FILE"
  (cd "$DIR/meta" && sha256sum -c --strict "$META_FILE.sha256")
  BAD="$(tar -tzf "$META_ARCHIVE" | awk '/^\// || /(^|\/)\.\.($|\/)/ || /\\/ {print; exit}')"
  [[ -z "$BAD" ]] || { echo "Небезопасный path в meta archive: $BAD" >&2; exit 3; }
  mkdir -p "$WORK/meta"
  tar -xzf "$META_ARCHIVE" -C "$WORK/meta" --no-same-owner --no-same-permissions
  mapfile -t roots < <(find "$WORK/meta" -mindepth 1 -maxdepth 1 -type d -print)
  [[ ${#roots[@]} -eq 1 ]] || { echo "Некорректная структура meta-bundle" >&2; exit 3; }
  "${roots[0]}/verify.sh"
  echo "==> Установка/обновление Project Control"
  "${roots[0]}/install.sh"
fi

python3 - "$BASE_URL" <<'PY'
import http.client, sys, time
from urllib.parse import urlparse
url=urlparse(sys.argv[1])
if url.scheme not in {'http','https'} or not url.hostname or url.query or url.fragment:
    raise SystemExit('Некорректный Project Control URL')
cls=http.client.HTTPSConnection if url.scheme=='https' else http.client.HTTPConnection
port=url.port or (443 if url.scheme=='https' else 80)
prefix=(url.path or '').rstrip('/')
endpoint=(prefix + '/api/ping') or '/api/ping'
last=None
for _ in range(60):
    try:
        c=cls(url.hostname,port,timeout=2); c.request('GET',endpoint); r=c.getresponse(); data=r.read(); c.close()
        if r.status==200: print(data.decode()); raise SystemExit(0)
        last=f'HTTP {r.status}: {data.decode(errors="replace")[:200]}'
    except Exception as exc: last=exc
    time.sleep(1)
raise SystemExit(f"Project Control не отвечает: {last}")
PY

TOKEN="$(python3 - <<'PY'
from pathlib import Path
path=Path('/etc/project-control/project-control.env')
for line in path.read_text(encoding='utf-8').splitlines():
    if line.startswith('PROJECT_CONTROL_ACCESS_TOKEN='):
        print(line.split('=',1)[1].strip()); break
else: raise SystemExit('PROJECT_CONTROL_ACCESS_TOKEN не найден')
PY
)"
[[ ${#TOKEN} -ge 24 ]] || { echo "Некорректный access token Project Control" >&2; exit 3; }
export PROJECT_CONTROL_ACCESS_TOKEN="$TOKEN"

preseed_kafedra_colocation() {
  local package="$1"
  [[ ! -e /opt/kafedra-planner/current && ! -f "$KAFEDRA_CONFIG" ]] || return 0
  local package_tool=/opt/project-control/current/src/package_tool.py
  [[ -f "$package_tool" ]] || { echo "Не найден package_tool Project Control: $package_tool" >&2; return 3; }
  local stage="$WORK/kafedra-preseed" wrapper="$WORK/kafedra-preseed/wrapper" native="$WORK/kafedra-preseed/native" payload
  mkdir -p "$wrapper" /etc/kafedra-planner
  payload="$(python3 "$package_tool" extract-payload "$package" "$wrapper")"
  python3 "$package_tool" extract-native "$payload" "$native" >/dev/null
  mapfile -t templates < <(find "$native" -type f -path '*/application/.env.example' -print)
  [[ ${#templates[@]} -eq 1 ]] || { echo "В Kafedra bundle не найден однозначный application/.env.example" >&2; return 3; }
  python3 - "${templates[0]}" "$KAFEDRA_CONFIG" "$KAFEDRA_API_PORT" "$KAFEDRA_LLM_PORT" <<'PY'
from pathlib import Path
import os, sys
source, destination = map(Path, sys.argv[1:3])
api_port, llm_port = sys.argv[3:5]
replacements = {
    'KAFEDRA_PORT': api_port,
    'KAFEDRA_LLM_ENDPOINT': f'http://127.0.0.1:{llm_port}',
    'KAFEDRA_LLM_PORT': llm_port,
}
lines = source.read_text(encoding='utf-8').splitlines()
seen = set()
out = []
for line in lines:
    name = line.split('=', 1)[0] if '=' in line else ''
    if name in replacements:
        out.append(f'{name}={replacements[name]}'); seen.add(name)
    else:
        out.append(line)
missing = set(replacements) - seen
if missing:
    raise SystemExit('В Kafedra .env.example отсутствуют: ' + ', '.join(sorted(missing)))
destination.write_text('\n'.join(out) + '\n', encoding='utf-8')
os.chmod(destination, 0o644)
PY
  KAFEDRA_CONFIG_PRESEEDED=true
  echo "    co-location: подготовлена первичная конфигурация Kafedra API=$KAFEDRA_API_PORT, LLM=$KAFEDRA_LLM_PORT"
}

finalize_kafedra_colocation() {
  [[ "$KAFEDRA_CONFIG_PRESEEDED" == true ]] || return 0
  getent group kafedra-planner >/dev/null 2>&1 || { echo "После установки отсутствует группа kafedra-planner" >&2; return 3; }
  chown root:kafedra-planner "$KAFEDRA_CONFIG"
  chmod 0640 "$KAFEDRA_CONFIG"
  KAFEDRA_CONFIG_PRESEEDED=false
}

mapfile -t PROJECT_ROWS < <(python3 - "$DIR/stack-release.json" "$ONLY_PROJECT" <<'PY'
import json,sys
release=json.load(open(sys.argv[1],encoding='utf-8')); only=sys.argv[2]
for p in release['projects']:
    if not only or p['projectId']==only:
        print('\t'.join((p['projectId'],p['file'],str(p['version']))))
PY
)

for row in "${PROJECT_ROWS[@]}"; do
  IFS=$'\t' read -r project_id package_file expected_version <<<"$row"
  package="$DIR/projects/$package_file"
  echo "==> $project_id -> $expected_version"
  if [[ "$project_id" == kafedra-planner ]]; then preseed_kafedra_colocation "$package"; fi
  python3 "$DIR/apply-package.py" "$project_id" "$package" --url "$BASE_URL"
  if [[ "$project_id" == kafedra-planner ]]; then finalize_kafedra_colocation; fi
  python3 - "$BASE_URL" "$TOKEN" "$project_id" "$expected_version" <<'PY'
import http.client, json, sys
from urllib.parse import urlparse
url=urlparse(sys.argv[1]); token, project_id, expected=sys.argv[2:]
if url.scheme not in {'http','https'} or not url.hostname or url.query or url.fragment:
    raise SystemExit('Некорректный Project Control URL')
cls=http.client.HTTPSConnection if url.scheme=='https' else http.client.HTTPConnection
port=url.port or (443 if url.scheme=='https' else 80)
prefix=(url.path or '').rstrip('/')
endpoint=(prefix + '/api/projects') or '/api/projects'
c=cls(url.hostname,port,timeout=15)
c.request('GET',endpoint,headers={'Authorization':f'Bearer {token}'})
r=c.getresponse(); payload=json.loads(r.read().decode('utf-8') or '{}'); c.close()
if r.status!=200: raise SystemExit(f"{endpoint} HTTP {r.status}: {payload}")
project=next((p for p in payload.get('projects',[]) if p.get('id')==project_id),None)
if not project: raise SystemExit(f"{project_id}: проект не найден после установки")
if project.get('version')!=expected: raise SystemExit(f"{project_id}: активна {project.get('version')}, ожидалась {expected}")
if not project.get('healthy'): raise SystemExit(f"{project_id}: health-check не зелёный: {project.get('health')}")
print(f"ok: {project_id} {expected} healthy")
PY
done

python3 - "$BASE_URL" "$TOKEN" <<'PY'
import http.client,json,sys
from urllib.parse import urlparse
url=urlparse(sys.argv[1]); token=sys.argv[2]
if url.scheme not in {'http','https'} or not url.hostname or url.query or url.fragment:
    raise SystemExit('Некорректный Project Control URL')
cls=http.client.HTTPSConnection if url.scheme=='https' else http.client.HTTPConnection
port=url.port or (443 if url.scheme=='https' else 80)
prefix=(url.path or '').rstrip('/')
endpoint=(prefix + '/api/projects') or '/api/projects'
c=cls(url.hostname,port,timeout=15)
c.request('GET',endpoint,headers={'Authorization':f'Bearer {token}'})
r=c.getresponse(); data=json.loads(r.read().decode() or '{}'); c.close()
print('\nИтог:')
for p in data.get('projects',[]): print(f"  {p['id']}: version={p.get('version') or '-'} healthy={bool(p.get('healthy'))}")
if r.status!=200: raise SystemExit(f"{endpoint} HTTP {r.status}: {data}")
PY

echo "F2RE Stack развёрнут успешно."
