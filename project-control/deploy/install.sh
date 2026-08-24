#!/usr/bin/env bash
set -Eeuo pipefail
[[ "${EUID:-$(id -u)}" -eq 0 ]] || { echo "Установку Project Control нужно запускать от root." >&2; exit 2; }

BUNDLE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
VERSION="$(tr -d '[:space:]' < "$BUNDLE_ROOT/VERSION")"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || { echo "Некорректный VERSION" >&2; exit 3; }
NODE="$BUNDLE_ROOT/runtime/node/bin/node"
[[ -x "$NODE" ]] || { echo "В offline bundle отсутствует runtime/node/bin/node" >&2; exit 3; }
PYTHON="${PROJECT_CONTROL_PYTHON_BIN:-/usr/bin/python3}"
[[ -x "$PYTHON" ]] || { echo "На Astra Linux требуется системный python3: $PYTHON" >&2; exit 3; }
"$PYTHON" -c 'import hashlib,json,tarfile,zipfile; print("python-ok")' >/dev/null

if [[ -f "$BUNDLE_ROOT/manifest.sha256" ]]; then
  for command in sha256sum find sort cmp; do command -v "$command" >/dev/null 2>&1 || { echo "Не найдена команда $command" >&2; exit 3; }; done
  TMP_MANIFEST="$(mktemp)"; TMP_ACTUAL="$(mktemp)"; trap 'rm -f "$TMP_MANIFEST" "$TMP_ACTUAL"' EXIT
  awk '{sub(/^\*/, "", $2); sub(/^\.\//, "", $2); print $2}' "$BUNDLE_ROOT/manifest.sha256" | LC_ALL=C sort > "$TMP_MANIFEST"
  (cd "$BUNDLE_ROOT"; find . -type f ! -path './manifest.sha256' -printf '%P\n' | LC_ALL=C sort) > "$TMP_ACTUAL"
  cmp -s "$TMP_MANIFEST" "$TMP_ACTUAL" || { echo "manifest.sha256 не соответствует содержимому bundle" >&2; exit 3; }
  (cd "$BUNDLE_ROOT"; sha256sum -c --strict manifest.sha256 >/dev/null) || { echo "SHA-256 offline bundle не прошёл проверку" >&2; exit 3; }
  rm -f "$TMP_MANIFEST" "$TMP_ACTUAL"; trap - EXIT
fi

APP_ROOT=/opt/project-control
CONFIG_DIR=/etc/project-control
CONFIG_FILE=$CONFIG_DIR/project-control.env
DATA_DIR=/var/lib/project-control
RELEASES=$APP_ROOT/releases
PREVIOUS=""
[[ -e "$APP_ROOT/current" ]] && PREVIOUS="$(readlink -f "$APP_ROOT/current" 2>/dev/null || true)"
FINGERPRINT="$(sha256sum "$BUNDLE_ROOT/manifest.sha256" 2>/dev/null | awk '{print substr($1,1,12)}')"
FINGERPRINT="${FINGERPRINT:-manual}"
RELEASE="$RELEASES/${VERSION}-${FINGERPRINT}"

getent group project-control >/dev/null 2>&1 || groupadd --system project-control
id project-control >/dev/null 2>&1 || useradd --system --gid project-control --home-dir "$DATA_DIR" --shell /usr/sbin/nologin project-control
install -d -o root -g root -m 0755 "$APP_ROOT" "$RELEASES"
install -d -o root -g project-control -m 0750 "$CONFIG_DIR" "$CONFIG_DIR/trusted-keys" "$DATA_DIR"
install -d -o project-control -g project-control -m 0750 "$DATA_DIR/incoming"
install -d -o root -g project-control -m 0750 "$DATA_DIR/staging" "$DATA_DIR/logs"

if [[ ! -d "$RELEASE" ]]; then
  STAGING="$RELEASES/.${VERSION}-${FINGERPRINT}.staging.$$"
  rm -rf "$STAGING"; mkdir -p "$STAGING"
  cp -a "$BUNDLE_ROOT/." "$STAGING/"
  chown -R root:root "$STAGING"
  chmod -R go-w "$STAGING"
  mv "$STAGING" "$RELEASE"
fi

NEW_CONFIG=false
if [[ ! -f "$CONFIG_FILE" ]]; then
  install -m 0640 -o root -g project-control "$RELEASE/config/project-control.env.example" "$CONFIG_FILE"
  NEW_CONFIG=true
fi
PIN="$(awk -F= '$1=="PROJECT_CONTROL_ACCESS_TOKEN"{gsub(/[[:space:]]/, "", $2); print $2; exit}' "$CONFIG_FILE")"
# 4 digits are intentionally the local UI PIN.  Rotate legacy long tokens on
# upgrade so the service and the displayed first-access credential stay in sync.
if [[ ! "$PIN" =~ ^[0-9]{4}$ ]]; then
  PIN="$("$NODE" -e 'const c=require("node:crypto"); process.stdout.write(String(c.randomInt(0, 10000)).padStart(4, "0"))')"
  if grep -q '^PROJECT_CONTROL_ACCESS_TOKEN=' "$CONFIG_FILE"; then
    sed -i "s|^PROJECT_CONTROL_ACCESS_TOKEN=.*$|PROJECT_CONTROL_ACCESS_TOKEN=$PIN|" "$CONFIG_FILE"
  else
    printf 'PROJECT_CONTROL_ACCESS_TOKEN=%s\n' "$PIN" >> "$CONFIG_FILE"
  fi
  FIRST_ACCESS=/root/project-control-access.txt
  printf 'Project Control\nURL: http://<IP-сервера>:9090/\nPIN доступа: %s\n\nPIN даёт право устанавливать и перезапускать системные службы. Храните его как root-секрет.\n' "$PIN" > "$FIRST_ACCESS"
  chmod 0600 "$FIRST_ACCESS"
  PIN_ROTATED=true
else
  PIN_ROTATED=false
fi
if grep -q '^PROJECT_CONTROL_VERSION=' "$CONFIG_FILE"; then
  sed -i "s|^PROJECT_CONTROL_VERSION=.*$|PROJECT_CONTROL_VERSION=$VERSION|" "$CONFIG_FILE"
else
  printf 'PROJECT_CONTROL_VERSION=%s\n' "$VERSION" >> "$CONFIG_FILE"
fi
chown root:project-control "$CONFIG_FILE"; chmod 0640 "$CONFIG_FILE"

ln -sfn "$RELEASE" "$APP_ROOT/.current.new"
mv -Tf "$APP_ROOT/.current.new" "$APP_ROOT/current"
install -m 0644 "$RELEASE/deploy/project-control-executor.service" /etc/systemd/system/project-control-executor.service
install -m 0644 "$RELEASE/deploy/project-control.service" /etc/systemd/system/project-control.service
systemctl daemon-reload

rollback() {
  status=$?
  trap - ERR
  echo "Project Control не прошёл запуск; возвращаю предыдущий release." >&2
  systemctl stop project-control.service project-control-executor.service >/dev/null 2>&1 || true
  if [[ -n "$PREVIOUS" && -d "$PREVIOUS" ]]; then
    ln -sfn "$PREVIOUS" "$APP_ROOT/.current.rollback"
    mv -Tf "$APP_ROOT/.current.rollback" "$APP_ROOT/current"
    systemctl daemon-reload
    systemctl start project-control-executor.service project-control.service >/dev/null 2>&1 || true
  fi
  exit "$status"
}
trap rollback ERR
systemctl enable project-control-executor.service project-control.service >/dev/null
systemctl restart project-control-executor.service
systemctl restart project-control.service

PORT="$(awk -F= '$1=="PROJECT_CONTROL_PORT"{gsub(/["[:space:]]/,"",$2); print $2; exit}' "$CONFIG_FILE")"
PORT="${PORT:-9090}"
for _ in $(seq 1 40); do
  if "$RELEASE/runtime/node/bin/node" -e 'const http=require("node:http");const p=Number(process.argv[1]);const r=http.get({host:"127.0.0.1",port:p,path:"/api/ping",timeout:1500},x=>{process.exit(x.statusCode===200?0:1)});r.on("error",()=>process.exit(1));r.on("timeout",()=>{r.destroy();process.exit(1)})' "$PORT"; then
    trap - ERR
    echo "Project Control $VERSION установлен и запущен."
    echo "Интерфейс: http://$(hostname -I 2>/dev/null | awk 'NF{print $1; exit}'):$PORT/"
    [[ "$NEW_CONFIG" == false && "$PIN_ROTATED" == false ]] || echo "PIN доступа: /root/project-control-access.txt"
    exit 0
  fi
  sleep 1
done
echo "Project Control не отвечает на /api/ping" >&2
false
