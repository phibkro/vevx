#!/bin/bash
# Varp freshness-track hook
# Warns when edited files fall within a component's scope
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
# Handles both Write (file_path) and Edit (file_path) tool inputs
file_path=""
if echo "$input" | grep -q '"file_path"'; then
  file_path=$(echo "$input" | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
fi

# Exit if no file path found
if [ -z "$file_path" ]; then
  exit 0
fi

# Normalize to relative path if absolute
if [[ "$file_path" = /* ]]; then
  # Try to make relative to current directory
  pwd_path=$(pwd)
  file_path_rel="${file_path#"$pwd_path"/}"
  # If still absolute, use as-is for matching
  if [[ "$file_path_rel" = /* ]]; then
    file_path_rel="$file_path"
  fi
else
  file_path_rel="$file_path"
fi

# Parse components and their paths from varp.yaml
in_components=false
current_comp=""
current_path=""
matched_comp=""

while IFS= read -r line; do
  if echo "$line" | grep -q '^components:'; then
    in_components=true
    continue
  fi
  if $in_components; then
    if echo "$line" | grep -q '^[^[:space:]]'; then
      break
    fi
    # Component name
    if echo "$line" | grep -qE '^  [a-zA-Z_][a-zA-Z0-9_-]*:'; then
      current_comp=$(echo "$line" | sed 's/^  \([a-zA-Z_][a-zA-Z0-9_-]*\):.*/\1/')
      current_path=""
    fi
    # Component path
    if echo "$line" | grep -qE '^    path:'; then
      current_path=$(echo "$line" | sed 's/^    path:[[:space:]]*//')
      # Normalize: strip leading ./
      current_path="${current_path#./}"

      # Check if edited file falls within this component's path
      file_check="${file_path_rel#./}"
      if echo "$file_check" | grep -q "^${current_path}"; then
        matched_comp="$current_comp"
        break
      fi
    fi
  fi
done < "$MANIFEST"

# Exit silently if file is not within any component
if [ -z "$matched_comp" ]; then
  exit 0
fi

# Find the interface doc for this component (first doc entry)
doc_path=""
in_components=false
found_comp=false
in_docs=false
while IFS= read -r line; do
  if echo "$line" | grep -q '^components:'; then
    in_components=true
    continue
  fi
  if $in_components; then
    if echo "$line" | grep -q '^[^[:space:]]'; then
      break
    fi
    if echo "$line" | grep -qE "^  ${matched_comp}:"; then
      found_comp=true
      continue
    fi
    if $found_comp; then
      # Another component starts
      if echo "$line" | grep -qE '^  [a-zA-Z_][a-zA-Z0-9_-]*:' && ! echo "$line" | grep -qE '^    '; then
        break
      fi
      if echo "$line" | grep -qE '^    docs:'; then
        in_docs=true
        continue
      fi
      if $in_docs; then
        if echo "$line" | grep -qE '^      interface:'; then
          doc_path=$(echo "$line" | sed 's/^      interface:[[:space:]]*//')
          break
        fi
      fi
    fi
  fi
done < "$MANIFEST"

if [ -n "$doc_path" ]; then
  echo "Note: Modified file in component \"${matched_comp}\" scope. Consider updating ${doc_path} if the API surface changed."
else
  echo "Note: Modified file in component \"${matched_comp}\" scope. Consider updating component docs if the API surface changed."
fi
