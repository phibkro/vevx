#!/bin/bash
# Varp freshness-track hook
# Reports which component a modified file belongs to
# Receives tool use context as JSON on stdin

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# Read stdin (JSON context from Claude Code)
input=$(cat)

# Extract file_path from JSON input
file_path=""
if echo "$input" | grep -q '"file_path"'; then
  file_path=$(echo "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

# Exit if no file path found or if editing a doc file
if [ -z "$file_path" ]; then
  exit 0
fi
case "$file_path" in
  *.md) exit 0 ;;
esac

# Normalize to relative path if absolute
if [[ "$file_path" = /* ]]; then
  pwd_path=$(pwd)
  file_path_rel="${file_path#"$pwd_path"/}"
  if [[ "$file_path_rel" = /* ]]; then
    file_path_rel="$file_path"
  fi
else
  file_path_rel="$file_path"
fi

# Parse components and their paths from flat varp.yaml
# Top-level keys (except 'varp') with a 'path:' child are components
current_key=""

while IFS= read -r line; do
  # Top-level key (no leading space)
  if echo "$line" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_-]*:'; then
    current_key="${line%%:*}"
    if [ "$current_key" = "varp" ]; then
      current_key=""
    fi
    continue
  fi
  # Component path (2 spaces indent)
  if [ -n "$current_key" ] && echo "$line" | grep -qE '^  path:'; then
    current_path="${line#  path:}"
    current_path="${current_path#"${current_path%%[! ]*}"}"
    current_path="${current_path#./}"

    file_check="${file_path_rel#./}"
    if echo "$file_check" | grep -q "^${current_path}"; then
      echo "Note: Modified file in component \"${current_key}\" scope."
      exit 0
    fi
  fi
done < "$MANIFEST"
