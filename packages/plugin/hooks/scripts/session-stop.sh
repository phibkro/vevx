#!/bin/bash
# Varp session-stop hook
# Summarizes session impact: modified components, coupling implications

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# ── Modified files since session start ──
# Uncommitted changes (staged + unstaged)
modified_files=$(git diff --name-only HEAD 2>/dev/null || true)
staged_files=$(git diff --cached --name-only 2>/dev/null || true)
# Committed changes during this session (saved by session-start.sh)
committed_files=""
if [ -f ".varp/session-head" ]; then
  session_head=$(cat .varp/session-head)
  committed_files=$(git diff --name-only "$session_head"..HEAD 2>/dev/null || true)
fi
all_modified=$(printf '%s\n%s\n%s' "$modified_files" "$staged_files" "$committed_files" | sort -u | grep -v '^$' || true)

if [ -z "$all_modified" ]; then
  exit 0
fi

# ── Map files to components ──
# Collect unique component names (bash 3.2 compatible, no associative arrays)
modified_comp_list=""
current_key=""
while IFS= read -r line; do
  if echo "$line" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_-]*:'; then
    current_key="${line%%:*}"
    [ "$current_key" = "varp" ] && current_key=""
    continue
  fi
  if [ -n "${current_key:-}" ] && echo "$line" | grep -qE '^  path:'; then
    comp_path="${line#  path:}"
    comp_path="${comp_path#"${comp_path%%[! ]*}"}"
    comp_path="${comp_path#./}"
    while IFS= read -r mf; do
      [ -z "$mf" ] && continue
      if echo "$mf" | grep -q "^${comp_path}"; then
        # Deduplicate: only add if not already present
        if ! echo "$modified_comp_list" | grep -qx "$current_key"; then
          modified_comp_list=$(printf '%s\n%s' "$modified_comp_list" "$current_key")
        fi
      fi
    done <<< "$all_modified"
  fi
done < "$MANIFEST"

# Trim leading blank line
modified_comp_list=$(echo "$modified_comp_list" | grep -v '^$' || true)

if [ -z "$modified_comp_list" ]; then
  exit 0
fi

comp_list=$(echo "$modified_comp_list" | paste -sd ', ' -)
echo "Session impact: modified components: ${comp_list}"

# ── Coupling implications ──
SUMMARY_CACHE=".varp/summary.json"
if [ -f "$SUMMARY_CACHE" ]; then
  hotspot_warnings=""
  while IFS= read -r comp; do
    if grep -oE '"pair": \["[^"]*", "[^"]*"\]' "$SUMMARY_CACHE" 2>/dev/null | grep -q "\"${comp}\""; then
      if [ -n "$hotspot_warnings" ]; then
        hotspot_warnings="${hotspot_warnings}, ${comp}"
      else
        hotspot_warnings="$comp"
      fi
    fi
  done <<< "$modified_comp_list"
  if [ -n "$hotspot_warnings" ]; then
    echo "Coupling warning: modified components with hidden coupling: ${hotspot_warnings}"
    echo "Consider running /varp:coupling to check for needed coordinated changes."
  fi
fi

# ── File count ──
file_count=$(echo "$all_modified" | wc -l | tr -d ' ')
echo "Files modified: ${file_count}"
