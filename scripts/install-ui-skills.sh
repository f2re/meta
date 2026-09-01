#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/install-ui-skills.sh <target-repo> [--copy|--link]

Installs the canonical UI skills from this repository into:
  <target-repo>/.agents/skills

Modes:
  --copy  Copy skill directories (default; suitable for committing into target repo)
  --link  Create symlinks back to this checkout (useful for local development)
EOF
}

if [[ $# -lt 1 ]]; then
  usage >&2
  exit 2
fi

TARGET=$(cd "$1" && pwd)
MODE=${2:---copy}
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$SCRIPT_DIR/.." && pwd)
SOURCE="$ROOT/.agents/skills"
DEST="$TARGET/.agents/skills"

if [[ ! -d "$TARGET/.git" ]]; then
  echo "Target is not a Git repository: $TARGET" >&2
  exit 3
fi

if [[ ! -d "$SOURCE" ]]; then
  echo "Skills source not found: $SOURCE" >&2
  exit 4
fi

mkdir -p "$DEST"

skills=(
  ui-skill-router
  qt-cpp-design-system
  meteorologist-workstation-ux
  viewport-map-interactions
  time-data-navigation
  meteorological-visualization
  dense-controls-and-selection
  workflow-and-progressive-disclosure
  motion-feedback-and-microinteractions
  states-errors-and-recovery
  operator-accessibility-and-safety
  ui-audit-and-acceptance
)

for skill in "${skills[@]}"; do
  src="$SOURCE/$skill"
  dst="$DEST/$skill"
  case "$MODE" in
    --copy)
      rm -rf "$dst"
      cp -a "$src" "$dst"
      ;;
    --link)
      rm -rf "$dst"
      ln -s "$src" "$dst"
      ;;
    *)
      echo "Unknown mode: $MODE" >&2
      usage >&2
      exit 2
      ;;
  esac
done

cp "$SOURCE/README.md" "$DEST/README.md"

echo "Installed ${#skills[@]} UI skills into $DEST"
echo "Codex should discover them from .agents/skills. Use /skills or mention \$ui-skill-router."
