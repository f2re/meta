#!/usr/bin/env bash
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DRY_RUN=false
SKIP_META=false
ONLY_PROJECT=""
BASE_URL="${PROJECT_CONTROL_URL:-http://127.0.0.1:9090}"

usage() {
  cat <<'EOF'
Использование: sudo ./deploy-stack.sh [опции]

  --dry-run              только проверить архив и показать план
  --skip-meta            не переустанавливать Project Control
  --project ID           обновить только один проект после meta
  --url URL              Project Control URL (по умолчанию http://127.0.0.1:9090)
  -h, --help             справка
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

for cmd in python3 sha256sum tar find; do command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда: $cmd" >&2; exit 2; }; done
"$DIR/verify.sh"

PLAN="$(python3 - "$DIR/stack-release.json" "$ONLY_PROJECT" <<'PY'
import json, sys
release=json.load(open(sys.argv[1], encoding='utf-8')); only=sys.argv[2]
print(f"Meta: {release['meta']['version']} ({release['meta']['file']})")
for p in release['projects']:
    if not only or p['projectId']==only:
        print(f"{p['projectId']}: {p['version']} ({p['file']})")
if only and only not in {p['projectId'] for p in release['projects']}:
    raise SystemExit(f"Неизвестный projectId: {only}")
PY
)"
printf 'План F2RE Stack:\n%s\n' "$PLAN"
[[ "$DRY_RUN" == false ]] || { echo "Dry-run: изменений не внесено."; exit 0; }
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Развёртывание нужно запускать от root." >&2; exit 2; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

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
url=urlparse(sys.argv[1]); cls=http.client.HTTPSConnection if url.scheme=='https' else http.client.HTTPConnection
port=url.port or (443 if url.scheme=='https' else 80)
last=None
for _ in range(60):
    try:
        c=cls(url.hostname,port,timeout=2); c.request('GET','/api/ping'); r=c.getresponse(); data=r.read()
        if r.status==200: print(data.decode()); raise SystemExit(0)
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
  python3 "$DIR/apply-package.py" "$project_id" "$package" --url "$BASE_URL"
  python3 - "$BASE_URL" "$TOKEN" "$project_id" "$expected_version" <<'PY'
import http.client, json, sys
from urllib.parse import urlparse
url=urlparse(sys.argv[1]); token, project_id, expected=sys.argv[2:]
cls=http.client.HTTPSConnection if url.scheme=='https' else http.client.HTTPConnection
port=url.port or (443 if url.scheme=='https' else 80)
c=cls(url.hostname,port,timeout=15)
c.request('GET','/api/projects',headers={'Authorization':f'Bearer {token}'})
r=c.getresponse(); payload=json.loads(r.read().decode('utf-8') or '{}')
if r.status!=200: raise SystemExit(f"/api/projects HTTP {r.status}: {payload}")
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
url=urlparse(sys.argv[1]); token=sys.argv[2]; cls=http.client.HTTPSConnection if url.scheme=='https' else http.client.HTTPConnection
c=cls(url.hostname,url.port or (443 if url.scheme=='https' else 80),timeout=15)
c.request('GET','/api/projects',headers={'Authorization':f'Bearer {token}'})
r=c.getresponse(); data=json.loads(r.read().decode() or '{}')
print('\nИтог:')
for p in data.get('projects',[]): print(f"  {p['id']}: version={p.get('version') or '-'} healthy={bool(p.get('healthy'))}")
if r.status!=200: raise SystemExit(1)
PY

echo "F2RE Stack развёрнут успешно."
