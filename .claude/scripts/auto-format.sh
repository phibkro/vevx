#!/bin/bash
# Varp auto-format hook
# Runs oxfmt + oxlint --fix on modified .ts files after Write/Edit
# Receives tool use context as JSON on stdin

set -euo pipefail

# Read stdin (JSON context from Claude Code)
input=$(cat)

# Extract file_path from JSON input
file_path=""
if echo "$input" | grep -q '"file_path"'; then
  file_path=$(echo "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

# Exit if no file path or not a TypeScript file
if [ -z "$file_path" ]; then
  exit 0
fi
case "$file_path" in
  *.ts) ;;
  *) exit 0 ;;
esac

# Only act on files within the project
if [ ! -f "$file_path" ]; then
  exit 0
fi

# Run format then lint fix (format first so lint sees clean formatting)
oxfmt --write "$file_path" 2>/dev/null || true
oxlint --fix "$file_path" 2>/dev/null || true
