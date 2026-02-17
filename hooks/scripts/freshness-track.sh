#!/bin/bash
# Varp freshness-track hook
# Warns when edited files fall within a component's scope
# Lists ALL stale docs per component (explicit + auto-discovered)
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

# Parse components and their paths from flat varp.yaml
# Top-level keys (except 'varp') with a 'path:' child are components
current_key=""
current_path=""
matched_comp=""
matched_path=""

while IFS= read -r line; do
  # Top-level key (no leading space)
  if echo "$line" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_-]*:'; then
    current_key="${line%%:*}"
    if [ "$current_key" = "varp" ]; then
      current_key=""
    fi
    current_path=""
    continue
  fi
  # Component path (2 spaces indent)
  if [ -n "$current_key" ] && echo "$line" | grep -qE '^  path:'; then
    current_path="${line#  path:}"
    current_path="${current_path#"${current_path%%[! ]*}"}"
    # Normalize: strip leading ./
    current_path="${current_path#./}"

    # Check if edited file falls within this component's path
    file_check="${file_path_rel#./}"
    if echo "$file_check" | grep -q "^${current_path}"; then
      matched_comp="$current_key"
      matched_path="$current_path"
      break
    fi
  fi
done < "$MANIFEST"

# Exit silently if file is not within any component
if [ -z "$matched_comp" ]; then
  exit 0
fi

# Collect explicit docs from varp.yaml for the matched component
declare -a doc_paths=()
found_comp=false
in_docs=false
while IFS= read -r line; do
  # Top-level key
  if echo "$line" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_-]*:'; then
    key="${line%%:*}"
    if [ "$key" = "$matched_comp" ]; then
      found_comp=true
    elif $found_comp; then
      break
    fi
    continue
  fi
  if $found_comp; then
    if echo "$line" | grep -qE '^  docs:'; then
      in_docs=true
      continue
    fi
    if $in_docs && echo "$line" | grep -qE '^    - '; then
      entry="${line#    - }"
      entry="${entry#"${entry%%[! ]*}"}"
      # Normalize: strip leading ./
      entry="${entry#./}"
      doc_paths+=("$entry")
    elif $in_docs && ! echo "$line" | grep -qE '^    - |^$'; then
      in_docs=false
    fi
  fi
done < "$MANIFEST"

# Auto-discover README.md at component root
readme_path="${matched_path}/README.md"
if [ -f "$readme_path" ]; then
  # Add if not already in explicit docs
  already_listed=false
  for dp in "${doc_paths[@]+"${doc_paths[@]}"}"; do
    if [ "$dp" = "$readme_path" ]; then
      already_listed=true
      break
    fi
  done
  if ! $already_listed; then
    doc_paths+=("$readme_path")
  fi
fi

# Auto-discover docs/*.md within component path
docs_dir="${matched_path}/docs"
if [ -d "$docs_dir" ]; then
  for md_file in "$docs_dir"/*.md; do
    # Guard against no-match glob expansion
    [ -f "$md_file" ] || continue
    # Strip leading ./
    md_file_norm="${md_file#./}"
    already_listed=false
    for dp in "${doc_paths[@]+"${doc_paths[@]}"}"; do
      if [ "$dp" = "$md_file_norm" ]; then
        already_listed=true
        break
      fi
    done
    if ! $already_listed; then
      doc_paths+=("$md_file_norm")
    fi
  done
fi

# If no docs found at all, emit a generic note
if [ ${#doc_paths[@]} -eq 0 ]; then
  echo "Note: Modified file in component \"${matched_comp}\" scope. Consider updating component docs if the API surface changed."
  exit 0
fi

# Find latest source file mtime in the component (seconds since epoch)
# Exclude .md files from source mtime calculation
latest_source_mtime=0
while IFS= read -r src_file; do
  # Skip markdown files — they are docs, not source
  case "$src_file" in
    *.md) continue ;;
  esac
  if [ -f "$src_file" ]; then
    file_mtime=$(stat -f '%m' "$src_file" 2>/dev/null || stat -c '%Y' "$src_file" 2>/dev/null || echo 0)
    if [ "$file_mtime" -gt "$latest_source_mtime" ]; then
      latest_source_mtime="$file_mtime"
    fi
  fi
done < <(find "$matched_path" -type f 2>/dev/null)

# Compare each doc's mtime against latest source mtime
declare -a stale_docs=()
for doc in "${doc_paths[@]}"; do
  if [ ! -f "$doc" ]; then
    # Missing doc counts as stale
    stale_docs+=("$doc (missing)")
    continue
  fi
  doc_mtime=$(stat -f '%m' "$doc" 2>/dev/null || stat -c '%Y' "$doc" 2>/dev/null || echo 0)
  if [ "$doc_mtime" -lt "$latest_source_mtime" ]; then
    stale_docs+=("$doc")
  fi
done

# Report stale docs
if [ ${#stale_docs[@]} -gt 0 ]; then
  echo "Note: Modified file in component \"${matched_comp}\" scope. The following docs may be stale:"
  for stale in "${stale_docs[@]}"; do
    echo "  - ${stale}"
  done
fi
