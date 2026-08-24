#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
NODE_RUNTIME_DIR="${NODE_RUNTIME_DIR:-}"
TARGET_ASTRA_VERSION="${TARGET_ASTRA_VERSION:-1.8}"

[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || { echo "Некорректный VERSION" >&2; exit 2; }
case "$TARGET_ASTRA_VERSION" in
  1.7|1.7.*|1.8|1.8.*) ;;
  *) echo "Поддерживаются target Astra Linux 1.7.x и 1.8.x" >&2; exit 2 ;;
esac
for cmd in tar gzip sha256sum find awk sort xargs python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда: $cmd" >&2; exit 2; }
done

if [[ -n "$NODE_RUNTIME_DIR" ]]; then
  VERIFY_NODE="$NODE_RUNTIME_DIR/bin/node"
else
  VERIFY_NODE="$(command -v node || true)"
fi
[[ -n "$VERIFY_NODE" && -x "$VERIFY_NODE" ]] || { echo "Для проверки compatibility manifest нужен Node.js." >&2; exit 2; }
"$VERIFY_NODE" "$ROOT/scripts/verify-compatibility.mjs"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CONTROLLER_OUT="$WORK/controller"
mkdir -p "$CONTROLLER_OUT"
OUT_DIR="$CONTROLLER_OUT" NODE_RUNTIME_DIR="$NODE_RUNTIME_DIR" "$ROOT/scripts/build-offline-bundle.sh"

mapfile -t controller_archives < <(find "$CONTROLLER_OUT" -maxdepth 1 -type f -name 'project-control-*.tar.gz' -print)
[[ ${#controller_archives[@]} -eq 1 ]] || { echo "Ожидался ровно один Project Control archive" >&2; exit 3; }
CONTROLLER_ARCHIVE="${controller_archives[0]}"
CONTROLLER_NAME="$(basename "$CONTROLLER_ARCHIVE")"
[[ -f "$CONTROLLER_ARCHIVE.sha256" && -x "$CONTROLLER_OUT/install-project-control.sh" ]] || {
  echo "Неполный Project Control offline bundle" >&2; exit 3;
}
(cd "$CONTROLLER_OUT" && sha256sum -c --strict "$CONTROLLER_NAME.sha256")

case "$CONTROLLER_NAME" in
  *-linux-x64.tar.gz) TARGET_ARCH=amd64 ;;
  *-linux-arm64.tar.gz) TARGET_ARCH=arm64 ;;
  *) echo "Неизвестная архитектура Project Control archive: $CONTROLLER_NAME" >&2; exit 3 ;;
esac

META_NAME="f2re-meta-${VERSION}-astra-${TARGET_ASTRA_VERSION}-${TARGET_ARCH}"
META_ROOT="$WORK/$META_NAME"
mkdir -p "$META_ROOT"
cp "$CONTROLLER_ARCHIVE" "$CONTROLLER_ARCHIVE.sha256" "$META_ROOT/"
cp "$CONTROLLER_OUT/install-project-control.sh" "$META_ROOT/"
cp "$ROOT/config/managed-projects.json" "$META_ROOT/managed-projects.json"

SOURCE_COMMIT="unknown"
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  SOURCE_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
fi
CONTROLLER_SHA256="$(sha256sum "$CONTROLLER_ARCHIVE" | awk '{print $1}')"
cat > "$META_ROOT/meta-release.json" <<EOF_RELEASE
{
  "schema": "f2re-meta-bundle/v1",
  "version": "$VERSION",
  "builtAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "sourceCommit": "$SOURCE_COMMIT",
  "target": {
    "os": "astra-linux-special-edition",
    "version": "$TARGET_ASTRA_VERSION",
    "architecture": "$TARGET_ARCH"
  },
  "controller": {
    "archive": "$CONTROLLER_NAME",
    "sha256": "$CONTROLLER_SHA256"
  },
  "managedProjects": "managed-projects.json"
}
EOF_RELEASE

cat > "$META_ROOT/install.sh" <<EOF_INSTALL
#!/usr/bin/env bash
set -Eeuo pipefail
DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd -P)"
exec "\$DIR/install-project-control.sh" "\$DIR/$CONTROLLER_NAME"
EOF_INSTALL

cat > "$META_ROOT/verify.sh" <<'EOF_VERIFY'
#!/usr/bin/env bash
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
for cmd in python3 sha256sum tar find sort cmp; do command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда: $cmd" >&2; exit 2; }; done
python3 - "$DIR/meta-release.json" "$DIR/managed-projects.json" <<'PY'
import json, re, sys
from pathlib import Path
release = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
managed = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
assert release["schema"] == "f2re-meta-bundle/v1"
assert release["target"]["os"] == "astra-linux-special-edition"
target_version = str(release["target"]["version"])
assert target_version == "1.7" or target_version.startswith("1.7.") or target_version == "1.8" or target_version.startswith("1.8.")
assert release["target"]["architecture"] in {"amd64", "arm64"}
assert managed["schema"] == "f2re-managed-projects/v1"
projects = managed["projects"]
assert len(projects) == 3
assert {p["projectId"] for p in projects} == {"docomator", "planer-solving", "kafedra-planner"}
for project in projects:
    assert re.fullmatch(r"[0-9a-f]{40}", project["verifiedCommit"])
    assert project["repository"].startswith("https://github.com/f2re/")
print("metadata-ok", target_version)
PY
ARCHIVE="$(python3 - "$DIR/meta-release.json" <<'PY'
import json, sys
from pathlib import Path
print(json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))["controller"]["archive"])
PY
)"
[[ -f "$DIR/$ARCHIVE" && -f "$DIR/$ARCHIVE.sha256" ]] || { echo "Не найден controller archive/checksum" >&2; exit 3; }
(cd "$DIR" && sha256sum -c --strict "$ARCHIVE.sha256")
BAD="$(tar -tzf "$DIR/$ARCHIVE" | awk '/^\// || /(^|\/)\.\.($|\/)/ || /\\/ {print; exit}')"
[[ -z "$BAD" ]] || { echo "Небезопасный путь в controller archive: $BAD" >&2; exit 3; }
mapfile -t roots < <(tar -tzf "$DIR/$ARCHIVE" | awk -F/ 'NF{print $1}' | sort -u)
[[ ${#roots[@]} -eq 1 ]] || { echo "Некорректная корневая структура controller archive" >&2; exit 3; }
tar -tzf "$DIR/$ARCHIVE" | grep -F "${roots[0]}/manifest.sha256" >/dev/null
if [[ -f "$DIR/SHA256SUMS" ]]; then
  (cd "$DIR" && sha256sum -c --strict SHA256SUMS)
fi
echo "F2RE meta-bundle проверен: metadata, checksum и структура корректны."
EOF_VERIFY

cat > "$META_ROOT/README-INSTALL.txt" <<EOF_README
F2RE Meta / Project Control $VERSION
Target: Astra Linux Special Edition $TARGET_ASTRA_VERSION ($TARGET_ARCH)

1. До распаковки проверьте внешний checksum:
   sha256sum -c ${META_NAME}.tar.gz.sha256

2. Распакуйте:
   tar -xzf ${META_NAME}.tar.gz
   cd ${META_NAME}

3. Проверьте вложенный controller bundle и compatibility manifest:
   ./verify.sh

4. Установите или обновите Project Control:
   sudo ./install.sh

5. При первой установке получите ключ доступа:
   sudo cat /root/project-control-access.txt

6. Проверка после установки:
   systemctl --no-pager --full status project-control-executor.service project-control.service
   curl -fsS http://127.0.0.1:9090/api/ping

Управляемые приложения не входят в этот архив. Их готовые *-project-control.f2re.zip
берутся из релизов/CI соответствующих репозиториев, перечисленных в managed-projects.json.
EOF_README

chmod 0755 "$META_ROOT/install.sh" "$META_ROOT/verify.sh" "$META_ROOT/install-project-control.sh"
(
  cd "$META_ROOT"
  find . -type f ! -path './SHA256SUMS' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > SHA256SUMS
  sha256sum -c --strict SHA256SUMS >/dev/null
)

mkdir -p "$OUT_DIR"
META_ARCHIVE="$OUT_DIR/$META_NAME.tar.gz"
TMP="$META_ARCHIVE.tmp.$$"
tar --sort=name --owner=0 --group=0 --numeric-owner -C "$WORK" -cf - "$META_NAME" | gzip -n -6 > "$TMP"
mv "$TMP" "$META_ARCHIVE"
(cd "$OUT_DIR" && sha256sum "$(basename "$META_ARCHIVE")" > "$(basename "$META_ARCHIVE").sha256")

printf 'F2RE meta-bundle for Astra Linux %s:\n  %s\n  %s.sha256\n' "$TARGET_ASTRA_VERSION" "$META_ARCHIVE" "$META_ARCHIVE"
