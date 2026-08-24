#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MANAGED="$ROOT/config/managed-projects.json"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
COMMAND="${1:-prepare}"
[[ $# -eq 0 ]] || shift
SOURCE_MODE=auto
OUT_DIR="${F2RE_STACK_OUT_DIR:-$ROOT/dist}"
INPUT_DIR=""
WORK_DIR="${F2RE_STACK_WORK_DIR:-}"
KEEP_WORK=false
NODE_VERSION="${F2RE_NODE_VERSION:-24.15.0}"

usage() {
  cat <<'EOF'
F2RE Stack — сборка/скачивание всех offline bundle одной командой.

  ./scripts/f2re-stack.sh prepare [--source auto|download|build] [--output DIR]
  ./scripts/f2re-stack.sh download [--output DIR]
  ./scripts/f2re-stack.sh build [--output DIR]
  ./scripts/f2re-stack.sh pack [--input DIR] [--output DIR]

prepare (по умолчанию): для каждого компонента сначала пытается скачать
точный проверенный GitHub Actions artifact закреплённого commit; если artifact
ещё недоступен, пересобирает только этот компонент локально. Затем создаёт один
f2re-stack-*-astra-1.8-amd64.tar.gz для переноса в закрытый контур.

Переменные:
  NODE_RUNTIME_DIR       готовый автономный Linux Node.js runtime
  F2RE_NODE_VERSION      версия Node для автозагрузки (24.15.0)
  F2RE_RELEASE_SIGNING_KEY  Ed25519 private key для локальной пересборки wrappers
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --source) [[ $# -ge 2 ]] || { echo "--source требует значение" >&2; exit 2; }; SOURCE_MODE="$2"; shift 2 ;;
    --output) [[ $# -ge 2 ]] || { echo "--output требует DIR" >&2; exit 2; }; OUT_DIR="$2"; shift 2 ;;
    --input) [[ $# -ge 2 ]] || { echo "--input требует DIR" >&2; exit 2; }; INPUT_DIR="$2"; shift 2 ;;
    --work-dir) [[ $# -ge 2 ]] || { echo "--work-dir требует DIR" >&2; exit 2; }; WORK_DIR="$2"; shift 2 ;;
    --keep-work) KEEP_WORK=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестная опция: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$COMMAND" in
  prepare|download|build|pack) ;;
  -h|--help) usage; exit 0 ;;
  *) echo "Неизвестная команда: $COMMAND" >&2; usage >&2; exit 2 ;;
esac
case "$SOURCE_MODE" in auto|download|build) ;; *) echo "--source: auto, download или build" >&2; exit 2 ;; esac
[[ "$COMMAND" != download ]] || SOURCE_MODE=download
[[ "$COMMAND" != build ]] || SOURCE_MODE=build

for cmd in python3 sha256sum tar gzip find git; do command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда: $cmd" >&2; exit 2; }; done
META_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
[[ "$META_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "Не удалось определить commit meta" >&2; exit 2; }
OUT_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUT_DIR")"
INPUT_DIR="${INPUT_DIR:-$OUT_DIR/stack-inputs}"
INPUT_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$INPUT_DIR")"
mkdir -p "$OUT_DIR"

if [[ -z "$WORK_DIR" ]]; then WORK_DIR="$(mktemp -d -t f2re-stack.XXXXXXXX)"; else mkdir -p "$WORK_DIR"; fi
cleanup() { [[ "$KEEP_WORK" == true ]] || rm -rf "$WORK_DIR"; }
trap cleanup EXIT

json_projects() {
  python3 - "$MANAGED" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8'))
for p in m['projects']:
    release=p['release']
    print('\t'.join((p['projectId'],p['repository'].removeprefix('https://github.com/'),p['verifiedCommit'],release.get('actionsArtifact',''))))
PY
}

artifact_for_commit() {
  local repo="$1" artifact="$2" commit="$3" destination="$4"
  command -v gh >/dev/null 2>&1 || return 20
  command -v unzip >/dev/null 2>&1 || return 21
  gh auth status >/dev/null 2>&1 || return 22
  local metadata run_id
  metadata="$(gh api -H 'Accept: application/vnd.github+json' "/repos/$repo/actions/artifacts?name=$artifact&per_page=100")" || return 23
  run_id="$(python3 - "$commit" <<'PY' <<<"$metadata"
import json,sys
expected=sys.argv[1]; data=json.load(sys.stdin)
items=[a for a in data.get('artifacts',[]) if not a.get('expired') and (a.get('workflow_run') or {}).get('head_sha')==expected]
items.sort(key=lambda a:a.get('created_at',''), reverse=True)
if items: print(items[0]['workflow_run']['id'])
PY
)"
  [[ -n "$run_id" ]] || return 24
  mkdir -p "$destination"
  gh run download "$run_id" --repo "$repo" --name "$artifact" --dir "$destination" >/dev/null || return 25
}

ensure_node_runtime() {
  if [[ -n "${NODE_RUNTIME_DIR:-}" ]]; then
    [[ -x "$NODE_RUNTIME_DIR/bin/node" ]] || { echo "NODE_RUNTIME_DIR не содержит bin/node" >&2; return 2; }
    printf '%s\n' "$NODE_RUNTIME_DIR"; return 0
  fi
  for cmd in curl xz; do command -v "$cmd" >/dev/null 2>&1 || { echo "Для автозагрузки Node.js нужен $cmd" >&2; return 2; }; done
  local machine node_arch archive base cache extracted
  machine="$(uname -m)"
  case "$machine" in x86_64|amd64) node_arch=x64 ;; aarch64|arm64) node_arch=arm64 ;; *) echo "Неподдерживаемая архитектура build host: $machine" >&2; return 2 ;; esac
  archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  base="https://nodejs.org/dist/v${NODE_VERSION}"
  cache="$WORK_DIR/node-runtime"
  mkdir -p "$cache"
  if [[ ! -f "$cache/$archive" ]]; then
    echo "==> Node.js $NODE_VERSION: загрузка автономного runtime" >&2
    curl -fL --retry 3 "$base/$archive" -o "$cache/$archive"
    curl -fL --retry 3 "$base/SHASUMS256.txt" -o "$cache/SHASUMS256.txt"
  fi
  (cd "$cache" && grep -E "  ${archive}$" SHASUMS256.txt | sha256sum -c --strict -)
  extracted="$cache/node-v${NODE_VERSION}-linux-${node_arch}"
  [[ -d "$extracted" ]] || tar -xJf "$cache/$archive" -C "$cache"
  [[ -x "$extracted/bin/node" && -x "$extracted/bin/npm" ]] || return 2
  printf '%s\n' "$extracted"
}

clone_exact() {
  local repo="$1" commit="$2" dest="$3"
  rm -rf "$dest"; mkdir -p "$dest"
  git -C "$dest" init -q
  git -C "$dest" remote add origin "https://github.com/$repo.git"
  git -C "$dest" fetch -q --depth=1 origin "$commit"
  git -C "$dest" checkout -q --detach FETCH_HEAD
  [[ "$(git -C "$dest" rev-parse HEAD)" == "$commit" ]] || { echo "$repo: checkout не совпал с pinned SHA" >&2; return 2; }
}

build_meta() {
  local dest="$1" runtime="$2"
  mkdir -p "$dest"
  echo "==> meta: локальная сборка Astra meta-bundle"
  OUT_DIR="$dest" NODE_RUNTIME_DIR="$runtime" TARGET_ASTRA_VERSION=1.8 "$ROOT/scripts/build-meta-bundle.sh" >/dev/null
}

build_docomator() {
  local repo="$1" commit="$2" dest="$3" runtime="$4" src="$WORK_DIR/src-docomator"
  echo "==> docomator: локальная сборка $commit"
  clone_exact "$repo" "$commit" "$src"
  (cd "$src" && PATH="$runtime/bin:$PATH" npm ci --ignore-scripts --no-audit --no-fund)
  mkdir -p "$dest"
  (cd "$src" && PATH="$runtime/bin:$PATH" PROJECT_CONTROL_PYTHON_BIN=python3 \
    ./scripts/project-control/build-bundle.sh \
      --target-profile generic --node-runtime-dir "$runtime" --without-llm --without-preview \
      --without-ux-acceptance --skip-tests --force --output "$dest") >/dev/null
}

build_planer() {
  local repo="$1" commit="$2" dest="$3" src="$WORK_DIR/src-planer" venv="$WORK_DIR/planer-venv"
  echo "==> planer-solving: локальная сборка $commit"
  clone_exact "$repo" "$commit" "$src"
  python3 -m venv "$venv" || { echo "Нужен python3-venv для локальной сборки planer-solving" >&2; return 2; }
  "$venv/bin/python" -m pip install --disable-pip-version-check -q -r "$src/requirements.txt"
  mkdir -p "$dest"
  (cd "$src" && PYTHON_BIN="$venv/bin/python" ./offline/build_project_control_bundle.sh --output "$dest" --python "$venv/bin/python") >/dev/null
}

build_kafedra() {
  local repo="$1" commit="$2" dest="$3" src="$WORK_DIR/src-kafedra"
  command -v docker >/dev/null 2>&1 || { echo "Для локальной full offline сборки kafedra-planner нужен Docker." >&2; return 2; }
  echo "==> kafedra-planner: локальная Debian 12 сборка $commit"
  clone_exact "$repo" "$commit" "$src"
  mkdir -p "$dest"
  docker run --rm -v "$src:/src:ro" -v "$dest:/out" node:24-bookworm bash -lc '
    set -Eeuo pipefail
    apt-get update >/dev/null
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 ca-certificates curl xz-utils binutils systemd >/dev/null
    cd /src
    OUT_DIR=/out KAFEDRA_FULL_BUNDLE_CACHE_DIR=/tmp/kafedra-cache PROJECT_CONTROL_PYTHON_BIN=python3 \
      bash scripts/offline/build-project-control-bundle.sh >/dev/null
  '
}

build_project() {
  local id="$1" repo="$2" commit="$3" dest="$4" runtime="$5"
  case "$id" in
    docomator) build_docomator "$repo" "$commit" "$dest" "$runtime" ;;
    planer-solving) build_planer "$repo" "$commit" "$dest" ;;
    kafedra-planner) build_kafedra "$repo" "$commit" "$dest" ;;
    *) echo "Неизвестный projectId: $id" >&2; return 2 ;;
  esac
}

acquire_all() {
  local mode="$1" runtime=""
  rm -rf "$INPUT_DIR"; mkdir -p "$INPUT_DIR"
  if [[ "$mode" == build ]]; then runtime="$(ensure_node_runtime)"; fi

  local meta_ok=false
  if [[ "$mode" != build ]]; then
    echo "==> meta: поиск проверенного GitHub Actions artifact $META_COMMIT"
    if artifact_for_commit "f2re/meta" "f2re-meta-astra-1.8-amd64" "$META_COMMIT" "$INPUT_DIR"; then meta_ok=true; else
      [[ "$mode" == auto ]] || { echo "Meta artifact для $META_COMMIT не найден." >&2; return 3; }
      echo "    artifact не найден — будет локальная сборка"
    fi
  fi
  if [[ "$meta_ok" == false ]]; then [[ -n "$runtime" ]] || runtime="$(ensure_node_runtime)"; build_meta "$INPUT_DIR" "$runtime"; fi

  while IFS=$'\t' read -r id repo commit artifact_template; do
    local ok=false artifact
    artifact="${artifact_template//\{commit\}/$commit}"
    if [[ "$mode" != build && -n "$artifact" ]]; then
      echo "==> $id: поиск проверенного artifact $artifact"
      if artifact_for_commit "$repo" "$artifact" "$commit" "$INPUT_DIR"; then ok=true; else
        [[ "$mode" == auto ]] || { echo "$id: artifact $artifact для $commit не найден." >&2; return 3; }
        echo "    artifact не найден — будет локальная сборка"
      fi
    fi
    if [[ "$ok" == false ]]; then
      [[ -n "$runtime" ]] || runtime="$(ensure_node_runtime)"
      build_project "$id" "$repo" "$commit" "$INPUT_DIR" "$runtime"
    fi
  done < <(json_projects)

  python3 "$ROOT/scripts/stack_tool.py" verify-inputs "$INPUT_DIR" "$MANAGED" --meta-commit "$META_COMMIT" >/dev/null
  echo "Все входные bundle проверены: $INPUT_DIR"
}

pack_all() {
  [[ -d "$INPUT_DIR" ]] || { echo "Нет каталога входных bundle: $INPUT_DIR" >&2; exit 3; }
  python3 "$ROOT/scripts/stack_tool.py" pack "$INPUT_DIR" "$MANAGED" "$OUT_DIR" --version "$VERSION" --meta-commit "$META_COMMIT"
}

case "$COMMAND" in
  download) acquire_all download ;;
  build) acquire_all build ;;
  pack) pack_all ;;
  prepare)
    acquire_all "$SOURCE_MODE"
    STACK_ARCHIVE="$(pack_all | tail -n 1)"
    echo
    echo "Готов единый переносимый F2RE Stack:"
    echo "  $STACK_ARCHIVE"
    echo "  $STACK_ARCHIVE.sha256"
    echo
    echo "На Astra Linux: sha256sum -c $(basename "$STACK_ARCHIVE").sha256 && tar -xzf $(basename "$STACK_ARCHIVE") && cd $(basename "$STACK_ARCHIVE" .tar.gz) && sudo ./deploy-stack.sh"
    ;;
esac
