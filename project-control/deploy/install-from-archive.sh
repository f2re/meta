#!/usr/bin/env bash
set -Eeuo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
ARCHIVE="${1:-}"
if [[ -z "$ARCHIVE" ]]; then
  mapfile -t archives < <(find "$SCRIPT_DIR" -maxdepth 1 -type f -name 'project-control-*.tar.gz' -print)
  [[ ${#archives[@]} -eq 1 ]] || { echo "Укажите путь к project-control-*.tar.gz" >&2; exit 2; }
  ARCHIVE="${archives[0]}"
fi
ARCHIVE="$(readlink -f "$ARCHIVE")"
CHECKSUM="$ARCHIVE.sha256"
[[ -f "$ARCHIVE" && -f "$CHECKSUM" ]] || { echo "Нужны archive и .sha256 рядом" >&2; exit 2; }
(cd "$(dirname "$ARCHIVE")"; sha256sum -c --strict "$(basename "$CHECKSUM")")
BAD="$(tar -tzf "$ARCHIVE" | awk '/^\// || /(^|\/)\.\.($|\/)/ || /\\/ {print; exit}')"
[[ -z "$BAD" ]] || { echo "Небезопасный путь в архиве: $BAD" >&2; exit 3; }
BAD_TYPE="$(tar -tvzf "$ARCHIVE" | awk 'substr($1,1,1)!="-" && substr($1,1,1)!="d" {print; exit}')"
[[ -z "$BAD_TYPE" ]] || { echo "Архив содержит неподдерживаемый тип объекта: $BAD_TYPE" >&2; exit 3; }
WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
tar -xzf "$ARCHIVE" -C "$WORK" --no-same-owner --no-same-permissions
mapfile -t roots < <(find "$WORK" -mindepth 1 -maxdepth 1 -type d -print)
[[ ${#roots[@]} -eq 1 && -x "${roots[0]}/install.sh" ]] || { echo "Некорректная структура Project Control bundle" >&2; exit 3; }
exec "${roots[0]}/install.sh"
