#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MANAGED_TEMPLATE="$ROOT/config/managed-projects.json"
MANAGED="$MANAGED_TEMPLATE"
VERSION="$(tr -d '[:space:]' < "$ROOT/VERSION")"
COMMAND="${1:-prepare}"
[[ $# -eq 0 ]] || shift
SOURCE_MODE="${F2RE_STACK_SOURCE_MODE:-build}"
PROJECT_REF_MODE="${F2RE_PROJECT_REF_MODE:-latest}"
TARGET_ASTRA_VERSION="${F2RE_TARGET_ASTRA_VERSION:-1.8}"
OUT_DIR="${F2RE_STACK_OUT_DIR:-$ROOT/dist}"
INPUT_DIR=""
WORK_DIR="${F2RE_STACK_WORK_DIR:-}"
KEEP_WORK=false
NODE_VERSION="${F2RE_NODE_VERSION:-24.19.0}"
NODE_RUNTIME_RESOLVED=""
BUILD_PYTHON_RESOLVED=""
DEFAULT_CACHE_BASE="${XDG_CACHE_HOME:-}"
if [[ -z "$DEFAULT_CACHE_BASE" ]]; then
  if [[ -n "${HOME:-}" ]]; then DEFAULT_CACHE_BASE="$HOME/.cache"; else DEFAULT_CACHE_BASE="$ROOT/.cache"; fi
fi
CACHE_DIR="${F2RE_STACK_CACHE_DIR:-$DEFAULT_CACHE_BASE/f2re-stack}"
CACHE_ENABLED=true
NPM_CACHE=""
PIP_CACHE=""
KAFEDRA_CACHE=""

usage() {
  cat <<'EOF_USAGE'
F2RE Stack — локальная сборка всех offline bundle одной командой.

  ./scripts/f2re-stack.sh prepare [--astra 1.7|1.8] [--refs latest|pinned] [--source build|auto|download] [--output DIR] [--cache-dir DIR|--no-cache]
  ./scripts/f2re-stack.sh download [--astra 1.7|1.8] [--refs pinned] [--output DIR]
  ./scripts/f2re-stack.sh build [--astra 1.7|1.8] [--refs latest|pinned] [--output DIR] [--cache-dir DIR|--no-cache]
  ./scripts/f2re-stack.sh pack [--astra 1.7|1.8] [--input DIR] [--output DIR]

prepare (по умолчанию) = build + latest: перед сборкой читает defaultBranch каждого
управляемого репозитория, разрешает текущий HEAD main в полный SHA, фиксирует этот
снимок и собирает именно его. Поэтому новая версия проекта попадает в stack без
ручного обновления verifiedCommit в meta.

--refs pinned использует SHA из config/managed-projects.json и нужен для строго
воспроизводимого исторического/release build. --source auto сначала ищет artifacts
для уже разрешённых SHA и локально собирает отсутствующие компоненты.
Docker не используется и не требуется.

Инструменты и package-manager downloads кешируются между запусками. По умолчанию
кеш находится в $XDG_CACHE_HOME/f2re-stack либо ~/.cache/f2re-stack. В нём
сохраняются проверенный standalone Node.js, npm cache, pip cache и runtime cache
Kafedra. --no-cache включает прежний одноразовый режим; --cache-dir задаёт путь.

Системный Node.js не требуется: официальный standalone Node.js автоматически
скачивается только при отсутствии корректной копии в кеше и проверяется по
SHASUMS256.txt. Для planer-solving нужен Python 3.11+; сам Python не скачивается —
скрипт выбирает уже установленный интерпретатор, а загружаемые pip-пакеты кеширует.

Переменные:
  F2RE_TARGET_ASTRA_VERSION целевая Astra Linux (1.7 или 1.8; default 1.8)
  F2RE_STACK_SOURCE_MODE    build (default), auto или download
  F2RE_PROJECT_REF_MODE     latest (default) или pinned
  F2RE_STACK_CACHE_DIR      постоянный кеш инструментов и зависимостей
  NODE_RUNTIME_DIR          готовый автономный Linux Node.js runtime
  F2RE_NODE_VERSION         версия Node для автозагрузки (24.19.0)
  F2RE_PYTHON_BIN           Python 3.11+ для сборки planer-solving
  F2RE_RELEASE_SIGNING_KEY  Ed25519 private key для локальной пересборки wrappers
EOF_USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --astra) [[ $# -ge 2 ]] || { echo "--astra требует 1.7 или 1.8" >&2; exit 2; }; TARGET_ASTRA_VERSION="$2"; shift 2 ;;
    --refs) [[ $# -ge 2 ]] || { echo "--refs требует latest или pinned" >&2; exit 2; }; PROJECT_REF_MODE="$2"; shift 2 ;;
    --source) [[ $# -ge 2 ]] || { echo "--source требует значение" >&2; exit 2; }; SOURCE_MODE="$2"; shift 2 ;;
    --output) [[ $# -ge 2 ]] || { echo "--output требует DIR" >&2; exit 2; }; OUT_DIR="$2"; shift 2 ;;
    --input) [[ $# -ge 2 ]] || { echo "--input требует DIR" >&2; exit 2; }; INPUT_DIR="$2"; shift 2 ;;
    --work-dir) [[ $# -ge 2 ]] || { echo "--work-dir требует DIR" >&2; exit 2; }; WORK_DIR="$2"; shift 2 ;;
    --cache-dir) [[ $# -ge 2 ]] || { echo "--cache-dir требует DIR" >&2; exit 2; }; CACHE_DIR="$2"; CACHE_ENABLED=true; shift 2 ;;
    --no-cache) CACHE_ENABLED=false; shift ;;
    --keep-work) KEEP_WORK=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Неизвестная опция: $1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$COMMAND" in prepare|download|build|pack) ;; -h|--help) usage; exit 0 ;; *) echo "Неизвестная команда: $COMMAND" >&2; usage >&2; exit 2 ;; esac
case "$SOURCE_MODE" in auto|download|build) ;; *) echo "--source: build, auto или download" >&2; exit 2 ;; esac
case "$PROJECT_REF_MODE" in latest|pinned) ;; *) echo "--refs: latest или pinned" >&2; exit 2 ;; esac
case "$TARGET_ASTRA_VERSION" in 1.7|1.8) ;; *) echo "--astra поддерживает только 1.7 или 1.8" >&2; exit 2 ;; esac
[[ "$COMMAND" != download ]] || SOURCE_MODE=download
[[ "$COMMAND" != build ]] || SOURCE_MODE=build
if [[ "$SOURCE_MODE" == download && "$PROJECT_REF_MODE" == latest ]]; then
  echo "Режим --source download требует --refs pinned: latest-снимок meta должен быть собран вместе с разрешёнными SHA." >&2
  echo "Для актуальных main используйте обычный prepare/build либо --source auto." >&2
  exit 2
fi

for cmd in python3 sha256sum tar gzip find git awk grep sort xargs; do command -v "$cmd" >/dev/null 2>&1 || { echo "Не найдена команда: $cmd" >&2; exit 2; }; done
META_COMMIT="$(git -C "$ROOT" rev-parse HEAD)"
[[ "$META_COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "Не удалось определить commit meta" >&2; exit 2; }
OUT_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$OUT_DIR")"
INPUT_DIR="${INPUT_DIR:-$OUT_DIR/stack-inputs-$TARGET_ASTRA_VERSION}"
INPUT_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(sys.argv[1]))' "$INPUT_DIR")"
mkdir -p "$OUT_DIR"

if [[ -z "$WORK_DIR" ]]; then WORK_DIR="$(mktemp -d -t f2re-stack.XXXXXXXX)"; else mkdir -p "$WORK_DIR"; fi
cleanup() { [[ "$KEEP_WORK" == true ]] || rm -rf "$WORK_DIR"; }
trap cleanup EXIT

if [[ "$CACHE_ENABLED" == true ]]; then
  CACHE_DIR="$(python3 -c 'import os,sys; print(os.path.abspath(os.path.expanduser(sys.argv[1])))' "$CACHE_DIR")"
  mkdir -p "$CACHE_DIR" || { echo "Не удалось создать кеш: $CACHE_DIR" >&2; exit 2; }
  echo "==> Кеш инструментов: $CACHE_DIR"
else
  CACHE_DIR="$WORK_DIR/cache"
  mkdir -p "$CACHE_DIR"
  echo "==> Кеш инструментов отключён: используется временный $CACHE_DIR"
fi
NPM_CACHE="$CACHE_DIR/npm"
PIP_CACHE="$CACHE_DIR/pip"
KAFEDRA_CACHE="$CACHE_DIR/kafedra-runtime/v${NODE_VERSION}"
mkdir -p "$NPM_CACHE" "$PIP_CACHE" "$KAFEDRA_CACHE"
export npm_config_cache="$NPM_CACHE"
export NPM_CONFIG_CACHE="$NPM_CACHE"
export PIP_CACHE_DIR="$PIP_CACHE"

resolve_project_refs() {
  local resolved="$WORK_DIR/managed-projects.resolved.json" refs="$WORK_DIR/project-refs.tsv"
  if [[ "$PROJECT_REF_MODE" == pinned ]]; then
    cp "$MANAGED_TEMPLATE" "$resolved"
    MANAGED="$resolved"
    echo "==> Проекты: используем pinned SHA из managed-projects.json"
    return 0
  fi

  : > "$refs"
  echo "==> Проекты: определяем актуальные HEAD defaultBranch"
  while IFS=$'\t' read -r id repository branch; do
    local sha
    sha="$(git ls-remote "$repository" "refs/heads/$branch" | awk 'NR == 1 {print $1}')"
    [[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
      echo "$id: не удалось определить $repository/$branch" >&2
      return 2
    }
    printf '%s\t%s\n' "$id" "$sha" >> "$refs"
    printf '    %-18s %s @ %s\n' "$id" "$branch" "$sha"
  done < <(python3 - "$MANAGED_TEMPLATE" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8'))
for p in m['projects']:
    print('\t'.join((p['projectId'],p['repository'],p.get('defaultBranch') or 'main')))
PY
)

  python3 - "$MANAGED_TEMPLATE" "$refs" "$resolved" <<'PY'
import datetime,json,sys
source,refs_path,target=sys.argv[1:]
manifest=json.load(open(source,encoding='utf-8'))
refs={}
with open(refs_path,encoding='utf-8') as stream:
    for line in stream:
        project_id,sha=line.rstrip('\n').split('\t',1)
        refs[project_id]=sha
for project in manifest['projects']:
    project['verifiedCommit']=refs[project['projectId']]
manifest['verifiedAt']=datetime.datetime.now(datetime.timezone.utc).date().isoformat()
with open(target,'w',encoding='utf-8') as stream:
    json.dump(manifest,stream,ensure_ascii=False,indent=2)
    stream.write('\n')
PY
  MANAGED="$resolved"
}

json_projects() {
  python3 - "$MANAGED" <<'PY'
import json,sys
m=json.load(open(sys.argv[1],encoding='utf-8'))
prefix='https://github.com/'
for p in m['projects']:
    release=p['release']; repository=p['repository']
    repo=repository[len(prefix):] if repository.startswith(prefix) else repository
    print('\t'.join((p['projectId'],repo,p['verifiedCommit'],release.get('actionsArtifact',''))))
PY
}

artifact_for_commit() {
  local repo="$1" artifact="$2" commit="$3" destination="$4"
  command -v gh >/dev/null 2>&1 || return 20
  gh auth status >/dev/null 2>&1 || return 22
  local safe metadata_file run_id
  safe="${repo//\//_}-${artifact//[^A-Za-z0-9._-]/_}"
  metadata_file="$WORK_DIR/$safe.json"
  gh api -H 'Accept: application/vnd.github+json' "/repos/$repo/actions/artifacts?name=$artifact&per_page=100" > "$metadata_file" || return 23
  run_id="$(python3 - "$commit" "$metadata_file" <<'PY'
import json,sys
expected=sys.argv[1]
with open(sys.argv[2],encoding='utf-8') as stream: data=json.load(stream)
items=[a for a in data.get('artifacts',[]) if not a.get('expired') and (a.get('workflow_run') or {}).get('head_sha')==expected]
items.sort(key=lambda a:a.get('created_at',''), reverse=True)
if items: print(items[0]['workflow_run']['id'])
PY
)"
  [[ -n "$run_id" ]] || return 24
  mkdir -p "$destination"
  gh run download "$run_id" --repo "$repo" --name "$artifact" --dir "$destination" >/dev/null || return 25
}

download_atomic() {
  local url="$1" target="$2" tmp
  tmp="${target}.part.$$"
  command -v curl >/dev/null 2>&1 || { echo "Для загрузки в кеш нужен curl" >&2; return 2; }
  rm -f "$tmp"
  curl -fL --retry 3 --retry-delay 1 "$url" -o "$tmp"
  mv "$tmp" "$target"
}

node_archive_valid() {
  local cache="$1" archive="$2"
  [[ -f "$cache/$archive" && -f "$cache/SHASUMS256.txt" ]] || return 1
  (cd "$cache" && grep -E "  ${archive}$" SHASUMS256.txt | sha256sum -c --strict - >/dev/null 2>&1)
}

ensure_node_runtime() {
  NODE_RUNTIME_RESOLVED=""
  if [[ -n "${NODE_RUNTIME_DIR:-}" ]]; then
    [[ -x "$NODE_RUNTIME_DIR/bin/node" ]] || { echo "NODE_RUNTIME_DIR не содержит bin/node" >&2; return 2; }
    NODE_RUNTIME_RESOLVED="$(cd "$NODE_RUNTIME_DIR" && pwd -P)"
    return 0
  fi

  local machine node_arch archive base cache extracted archive_ok=false
  machine="$(uname -m)"
  case "$machine" in x86_64|amd64) node_arch=x64 ;; aarch64|arm64) node_arch=arm64 ;; *) echo "Неподдерживаемая архитектура build host: $machine" >&2; return 2 ;; esac
  archive="node-v${NODE_VERSION}-linux-${node_arch}.tar.xz"
  base="https://nodejs.org/dist/v${NODE_VERSION}"
  cache="$CACHE_DIR/node/v${NODE_VERSION}/linux-${node_arch}"
  extracted="$cache/node-v${NODE_VERSION}-linux-${node_arch}"
  mkdir -p "$cache"

  if node_archive_valid "$cache" "$archive"; then
    archive_ok=true
  elif [[ -f "$cache/$archive" || -f "$cache/SHASUMS256.txt" ]]; then
    echo "    Кеш Node.js неполон или повреждён — восстанавливаем." >&2
    rm -f "$cache/$archive" "$cache/SHASUMS256.txt"
    rm -rf "$extracted"
  fi

  if [[ "$archive_ok" == true && -x "$extracted/bin/node" && -x "$extracted/bin/npm" ]] && \
     [[ "$("$extracted/bin/node" --version 2>/dev/null || true)" == "v${NODE_VERSION}" ]]; then
    echo "==> Node.js $NODE_VERSION: используем проверенный кеш"
    NODE_RUNTIME_RESOLVED="$extracted"
    return 0
  fi

  if [[ "$archive_ok" == false ]]; then
    echo "==> Node.js $NODE_VERSION: нет в кеше, загружаем один раз" >&2
    download_atomic "$base/SHASUMS256.txt" "$cache/SHASUMS256.txt"
    download_atomic "$base/$archive" "$cache/$archive"
    if ! node_archive_valid "$cache" "$archive"; then
      echo "Кеш Node.js не прошёл SHA-256 проверку после загрузки." >&2
      rm -f "$cache/$archive" "$cache/SHASUMS256.txt"
      return 2
    fi
  fi

  if [[ ! -x "$extracted/bin/node" || ! -x "$extracted/bin/npm" ]] || \
     [[ "$("$extracted/bin/node" --version 2>/dev/null || true)" != "v${NODE_VERSION}" ]]; then
    command -v xz >/dev/null 2>&1 || { echo "Для распаковки Node.js нужен xz" >&2; return 2; }
    local extract_tmp="$cache/.extract.$$"
    rm -rf "$extract_tmp" "$extracted"
    mkdir -p "$extract_tmp"
    tar -xJf "$cache/$archive" -C "$extract_tmp"
    [[ -d "$extract_tmp/node-v${NODE_VERSION}-linux-${node_arch}" ]] || { echo "Архив Node.js имеет неожиданную структуру" >&2; rm -rf "$extract_tmp"; return 2; }
    mv "$extract_tmp/node-v${NODE_VERSION}-linux-${node_arch}" "$extracted"
    rmdir "$extract_tmp" 2>/dev/null || true
  fi

  [[ -x "$extracted/bin/node" && -x "$extracted/bin/npm" ]] || { echo "Скачанный Node.js runtime неполон: $extracted" >&2; return 2; }
  [[ "$("$extracted/bin/node" --version)" == "v${NODE_VERSION}" ]] || { echo "Версия Node.js в кеше не совпадает с $NODE_VERSION" >&2; return 2; }
  echo "    Node.js сохранён в кеш: $extracted" >&2
  NODE_RUNTIME_RESOLVED="$extracted"
}

require_node_runtime() {
  if [[ -z "$NODE_RUNTIME_RESOLVED" ]]; then ensure_node_runtime; fi
  [[ -n "$NODE_RUNTIME_RESOLVED" && "$NODE_RUNTIME_RESOLVED" != *$'\n'* && -x "$NODE_RUNTIME_RESOLVED/bin/node" ]] || {
    echo "Не удалось однозначно определить автономный Node.js runtime." >&2
    return 2
  }
  echo "    Node runtime: $NODE_RUNTIME_RESOLVED ($("$NODE_RUNTIME_RESOLVED/bin/node" --version))" >&2
}

ensure_build_python() {
  BUILD_PYTHON_RESOLVED=""
  local candidate resolved
  local candidates=()
  [[ -z "${F2RE_PYTHON_BIN:-}" ]] || candidates+=("$F2RE_PYTHON_BIN")
  candidates+=(/usr/bin/python3 python3.13 python3.12 python3.11 python3)
  for candidate in "${candidates[@]}"; do
    if [[ "$candidate" == */* ]]; then
      [[ -x "$candidate" ]] || continue
      resolved="$candidate"
    else
      resolved="$(command -v "$candidate" 2>/dev/null || true)"
      [[ -n "$resolved" && -x "$resolved" ]] || continue
    fi
    if "$resolved" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 11) else 1)' >/dev/null 2>&1; then
      BUILD_PYTHON_RESOLVED="$(readlink -f "$resolved" 2>/dev/null || printf '%s' "$resolved")"
      return 0
    fi
  done
  echo "Для локальной сборки planer-solving нужен Python 3.11 или новее. Установите python3.11+ или задайте F2RE_PYTHON_BIN." >&2
  return 2
}

require_build_python() {
  if [[ -z "$BUILD_PYTHON_RESOLVED" ]]; then ensure_build_python; fi
  [[ -x "$BUILD_PYTHON_RESOLVED" ]] || return 2
  echo "    Python build runtime: $BUILD_PYTHON_RESOLVED ($("$BUILD_PYTHON_RESOLVED" --version 2>&1))" >&2
  echo "    pip cache: $PIP_CACHE" >&2
}

clone_exact() {
  local repo="$1" commit="$2" dest="$3"
  rm -rf "$dest"; mkdir -p "$dest"
  git -C "$dest" init -q
  git -C "$dest" remote add origin "https://github.com/$repo.git"
  git -C "$dest" fetch -q --depth=1 origin "$commit"
  git -C "$dest" checkout -q --detach FETCH_HEAD
  [[ "$(git -C "$dest" rev-parse HEAD)" == "$commit" ]] || { echo "$repo: checkout не совпал с resolved SHA" >&2; return 2; }
}

source_version() {
  local src="$1"
  if [[ -f "$src/VERSION" ]]; then tr -d '[:space:]' < "$src/VERSION"
  elif [[ -f "$src/package.json" ]]; then python3 -c 'import json,sys; print(json.load(open(sys.argv[1],encoding="utf-8")).get("version","unknown"))' "$src/package.json"
  else printf 'unknown\n'
  fi
}

build_meta() {
  local dest="$1" runtime="$2"
  mkdir -p "$dest"
  echo "==> meta: локальная сборка Astra $TARGET_ASTRA_VERSION meta-bundle"
  OUT_DIR="$dest" NODE_RUNTIME_DIR="$runtime" TARGET_ASTRA_VERSION="$TARGET_ASTRA_VERSION" \
    F2RE_MANAGED_PROJECTS_FILE="$MANAGED" "$ROOT/scripts/build-meta-bundle.sh" >/dev/null
}

build_docomator() {
  local repo="$1" commit="$2" dest="$3" runtime="$4" src="$WORK_DIR/src-docomator"
  echo "==> docomator: локальная сборка $commit"
  clone_exact "$repo" "$commit" "$src"
  echo "    docomator: версия $(source_version "$src"), commit $commit"
  mkdir -p "$dest"
  (cd "$src" && PATH="$runtime/bin:$PATH" PROJECT_CONTROL_PYTHON_BIN=python3 \
    npm_config_cache="$NPM_CACHE" NPM_CONFIG_CACHE="$NPM_CACHE" \
    ./scripts/project-control/build-bundle.sh \
      --target-profile generic --node-runtime-dir "$runtime" --without-llm --without-preview \
      --without-ux-acceptance --skip-tests --force --output "$dest") >/dev/null
}

build_planer() {
  local repo="$1" commit="$2" dest="$3" src="$WORK_DIR/src-planer" venv="$WORK_DIR/planer-venv" python_bin
  echo "==> planer-solving: локальная сборка $commit"
  clone_exact "$repo" "$commit" "$src"
  echo "    planer-solving: версия $(source_version "$src"), commit $commit"
  require_build_python
  python_bin="$BUILD_PYTHON_RESOLVED"
  rm -rf "$venv"
  "$python_bin" -m venv "$venv" || { echo "Не удалось создать venv через $python_bin. Проверьте модуль venv для Python 3.11+." >&2; return 2; }
  PIP_CACHE_DIR="$PIP_CACHE" "$venv/bin/python" -m pip install --disable-pip-version-check -q -r "$src/requirements.txt"
  mkdir -p "$dest"
  (cd "$src" && PIP_CACHE_DIR="$PIP_CACHE" PYTHON_BIN="$venv/bin/python" ./offline/build_project_control_bundle.sh --output "$dest" --python "$venv/bin/python") >/dev/null
}

build_kafedra() {
  local repo="$1" commit="$2" dest="$3" runtime="$4" src="$WORK_DIR/src-kafedra" archive package
  echo "==> kafedra-planner: локальная runtime-offline сборка $commit (без Docker)"
  clone_exact "$repo" "$commit" "$src"
  echo "    kafedra-planner: версия $(source_version "$src"), commit $commit"
  mkdir -p "$dest"
  (cd "$src" && \
    PATH="$runtime/bin:$PATH" \
    npm_config_cache="$NPM_CACHE" \
    NPM_CONFIG_CACHE="$NPM_CACHE" \
    GITHUB_SHA="$commit" \
    OUT_DIR="$dest" \
    KAFEDRA_RUNTIME_CACHE_DIR="$KAFEDRA_CACHE" \
    bash scripts/offline/build-bundle.sh >/dev/null)
  archive="$(find "$dest" -maxdepth 1 -type f -name 'kafedra-planner-*.tar.gz' ! -name '*-llm.tar.gz' -print -quit)"
  [[ -n "$archive" && -f "$archive" && -f "$archive.sha256" ]] || { echo "Kafedra runtime offline bundle не создан" >&2; return 3; }
  args=(
    --archive "$archive" --output "$dest" --project-id kafedra-planner --display-name "Кафедра Planner"
    --adapter kafedra-planner-v1 --version "$(tr -d '[:space:]' < "$src/VERSION")"
    --source-commit "$commit" --native-format kafedra-runtime-offline-v1
  )
  [[ -z "${F2RE_RELEASE_SIGNING_KEY:-}" ]] || args+=(--signing-key "$F2RE_RELEASE_SIGNING_KEY")
  python3 "$src/scripts/offline/project-control-package.py" "${args[@]}" >/dev/null
  package="$(find "$dest" -maxdepth 1 -type f -name 'kafedra-planner-*-project-control.f2re.zip' -print -quit)"
  [[ -n "$package" && -f "$package" && -f "$package.sha256" ]] || { echo "Kafedra Project Control package не создан" >&2; return 3; }
  echo "    Kafedra: runtime-only package; ядро работает офлайн, OCR/LibreOffice/Poppler используют уже установленные возможности target ОС." >&2
}

build_project() {
  local id="$1" repo="$2" commit="$3" dest="$4" runtime="$5"
  case "$id" in
    docomator) build_docomator "$repo" "$commit" "$dest" "$runtime" ;;
    planer-solving) build_planer "$repo" "$commit" "$dest" ;;
    kafedra-planner) build_kafedra "$repo" "$commit" "$dest" "$runtime" ;;
    *) echo "Неизвестный projectId: $id" >&2; return 2 ;;
  esac
}

acquire_all() {
  local mode="$1" runtime=""
  resolve_project_refs
  rm -rf "$INPUT_DIR"; mkdir -p "$INPUT_DIR"
  cp "$MANAGED" "$INPUT_DIR/managed-projects.resolved.json"
  if [[ "$mode" == build ]]; then
    require_node_runtime
    runtime="$NODE_RUNTIME_RESOLVED"
  fi

  local meta_ok=false
  if [[ "$mode" != build && "$PROJECT_REF_MODE" == pinned ]]; then
    local meta_artifact="f2re-meta-astra-${TARGET_ASTRA_VERSION}-amd64"
    echo "==> meta: поиск проверенного GitHub Actions artifact $meta_artifact для $META_COMMIT"
    if artifact_for_commit "f2re/meta" "$meta_artifact" "$META_COMMIT" "$INPUT_DIR"; then meta_ok=true; else
      [[ "$mode" == auto ]] || { echo "Meta artifact $meta_artifact для $META_COMMIT не найден." >&2; return 3; }
      echo "    artifact не найден — будет локальная сборка"
    fi
  fi
  if [[ "$meta_ok" == false ]]; then
    if [[ -z "$runtime" ]]; then require_node_runtime; runtime="$NODE_RUNTIME_RESOLVED"; fi
    build_meta "$INPUT_DIR" "$runtime"
  fi

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
      if [[ -z "$runtime" ]]; then require_node_runtime; runtime="$NODE_RUNTIME_RESOLVED"; fi
      build_project "$id" "$repo" "$commit" "$INPUT_DIR" "$runtime"
    fi
  done < <(json_projects)

  python3 "$ROOT/scripts/stack_tool.py" verify-inputs "$INPUT_DIR" "$MANAGED" \
    --meta-commit "$META_COMMIT" --astra-version "$TARGET_ASTRA_VERSION" >/dev/null
  echo "Все входные bundle проверены: $INPUT_DIR"
}

pack_all() {
  [[ -d "$INPUT_DIR" ]] || { echo "Нет каталога входных bundle: $INPUT_DIR" >&2; exit 3; }
  if [[ -f "$INPUT_DIR/managed-projects.resolved.json" ]]; then
    MANAGED="$INPUT_DIR/managed-projects.resolved.json"
  fi
  python3 "$ROOT/scripts/stack_tool.py" pack "$INPUT_DIR" "$MANAGED" "$OUT_DIR" \
    --version "$VERSION" --meta-commit "$META_COMMIT" --astra-version "$TARGET_ASTRA_VERSION"
}

case "$COMMAND" in
  download) acquire_all download ;;
  build) acquire_all build ;;
  pack) pack_all ;;
  prepare)
    acquire_all "$SOURCE_MODE"
    STACK_ARCHIVE="$(pack_all | tail -n 1)"
    echo
    echo "Готов единый переносимый F2RE Stack для Astra Linux $TARGET_ASTRA_VERSION:"
    echo "  $STACK_ARCHIVE"
    echo "  $STACK_ARCHIVE.sha256"
    echo
    echo "На Astra Linux $TARGET_ASTRA_VERSION: sha256sum -c $(basename "$STACK_ARCHIVE").sha256 && tar -xzf $(basename "$STACK_ARCHIVE") && cd $(basename "$STACK_ARCHIVE" .tar.gz) && sudo ./deploy-stack.sh"
    ;;
esac
