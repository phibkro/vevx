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
      break
    fi
  fi
done < "$MANIFEST"

# ── Coupling awareness ──
# Check .varp/summary.json for coupling hotspot data (written by varp summary)
SUMMARY_CACHE=".varp/summary.json"
if [ ! -f "$SUMMARY_CACHE" ]; then
  exit 0
fi

# Look up the file in hotspot_files using grep (fast, no jq dependency)
# summary.json has: "hotspot_files": { "path/to/file.ts": ["other.ts (0.72)", ...], ... }
file_check="${file_path_rel#./}"

# Escape dots and slashes for grep pattern
file_pattern=$(printf '%s' "$file_check" | sed 's/[.[\\/]/\\&/g')

# Extract coupling neighbors for this file from pretty-printed JSON
# Uses sed to join the multi-line array into a single line, then grep for our key
if neighbors=$(sed -n "/\"${file_pattern}\": \[/,/\]/p" "$SUMMARY_CACHE" 2>/dev/null); then
  # Strip JSON syntax to get readable list
  neighbor_list=$(echo "$neighbors" | grep -v "\"${file_pattern}\"" | sed 's/[]",[]//g' | xargs)
  if [ -n "$neighbor_list" ]; then
    echo "Coupling note: files that typically co-change: ${neighbor_list}"
  fi
fi
