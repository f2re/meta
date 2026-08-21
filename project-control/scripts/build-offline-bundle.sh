#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
OUT_DIR="${OUT_DIR:-$ROOT/dist}"
NODE_RUNTIME_DIR="${NODE_RUNTIME_DIR:-}"
[[ "$VERSION" =~ ^[A-Za-z0-9][A-Za-z0-9._+-]*$ ]] || { echo "Некорректный VERSION" >&2; exit 2; }
for cmd in tar gzip sha256sum find sort xargs; do command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда: $cmd" >&2; exit 2; }; done

if [[ -n "$NODE_RUNTIME_DIR" ]]; then
  NODE_SOURCE="$NODE_RUNTIME_DIR/bin/node"
  LICENSE_SOURCE="$NODE_RUNTIME_DIR/LICENSE"
else
  command -v node >/dev/null 2>&1 || { echo "Не найден host Node.js; передайте NODE_RUNTIME_DIR." >&2; exit 2; }
  NODE_SOURCE="$(readlink -f "$(command -v node)")"
  NODE_HOME="$(cd "$(dirname "$NODE_SOURCE")/.." && pwd -P)"
  LICENSE_SOURCE="$NODE_HOME/LICENSE"
  if command -v ldd >/dev/null 2>&1 && ldd "$NODE_SOURCE" 2>/dev/null | grep -Eq '(^|[[:space:]/])libnode\.so'; then
    echo "Системный node зависит от libnode.so. Передайте NODE_RUNTIME_DIR с официальным автономным Node.js runtime." >&2
    exit 2
  fi
fi
[[ -x "$NODE_SOURCE" ]] || { echo "Node runtime не найден: $NODE_SOURCE" >&2; exit 2; }
[[ -f "$LICENSE_SOURCE" ]] || { echo "LICENSE Node.js не найден: $LICENSE_SOURCE" >&2; exit 2; }
NODE_VERSION="$($NODE_SOURCE --version)"
ARCH="$($NODE_SOURCE -p 'process.arch')"
PLATFORM="$($NODE_SOURCE -p 'process.platform')"
[[ "$PLATFORM" == linux && ( "$ARCH" == x64 || "$ARCH" == arm64 ) ]] || { echo "Нужен Linux Node.js x64/arm64" >&2; exit 2; }

GIT_COMMIT="unknown"
if command -v git >/dev/null 2>&1 && git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  [[ -z "$(git -C "$ROOT" status --porcelain --untracked-files=normal)" ]] || { echo "Рабочее дерево должно быть чистым перед release bundle." >&2; exit 2; }
  GIT_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
fi

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
BUNDLE_NAME="project-control-${VERSION}-linux-${ARCH}"
BUNDLE="$WORK/$BUNDLE_NAME"
mkdir -p "$BUNDLE/runtime/node/bin" "$OUT_DIR"
cp -a "$ROOT/src" "$ROOT/public" "$ROOT/deploy" "$ROOT/config" "$ROOT/scripts" "$ROOT/docs" "$ROOT/package.json" "$ROOT/VERSION" "$ROOT/README.md" "$BUNDLE/"
cp "$NODE_SOURCE" "$BUNDLE/runtime/node/bin/node"
cp "$LICENSE_SOURCE" "$BUNDLE/runtime/node/LICENSE"
chmod 0755 "$BUNDLE/runtime/node/bin/node" "$BUNDLE/deploy/install.sh" "$BUNDLE/deploy/install-from-archive.sh" "$BUNDLE/src/package_tool.py" "$BUNDLE/scripts/"*.sh "$BUNDLE/scripts/"*.py
cp "$BUNDLE/deploy/install.sh" "$BUNDLE/install.sh"
cat > "$BUNDLE/release.json" <<EOF_RELEASE
{
  "name": "project-control",
  "version": "$VERSION",
  "schemaVersion": 1,
  "builtAt": "$(date -u +'%Y-%m-%dT%H:%M:%SZ')",
  "gitCommit": "$GIT_COMMIT",
  "platform": "$PLATFORM",
  "architecture": "$ARCH",
  "nodeVersion": "$NODE_VERSION"
}
EOF_RELEASE
(
  cd "$BUNDLE"
  find . -type f ! -path './manifest.sha256' -print0 | LC_ALL=C sort -z | xargs -0 sha256sum > manifest.sha256
  sha256sum -c --strict manifest.sha256 >/dev/null
)
ARCHIVE="$OUT_DIR/$BUNDLE_NAME.tar.gz"
TMP="$ARCHIVE.tmp.$$"
tar --sort=name --owner=0 --group=0 --numeric-owner -C "$WORK" -cf - "$BUNDLE_NAME" | gzip -n -6 > "$TMP"
mv "$TMP" "$ARCHIVE"
(cd "$OUT_DIR"; sha256sum "$(basename "$ARCHIVE")" > "$(basename "$ARCHIVE").sha256")
cp "$ROOT/deploy/install-from-archive.sh" "$OUT_DIR/install-project-control.sh"
chmod 0755 "$OUT_DIR/install-project-control.sh"
printf 'Project Control offline bundle:\n  %s\n  %s.sha256\n  %s/install-project-control.sh\n' "$ARCHIVE" "$ARCHIVE" "$OUT_DIR"
