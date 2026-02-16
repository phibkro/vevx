#!/bin/bash
# Varp session-start hook
# Outputs project summary when varp.yaml is present

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# Parse version
project_version=$(grep '^varp:' "$MANIFEST" | sed 's/^varp:[[:space:]]*//')

# Parse component names (top-level keys that aren't 'varp')
# In flat format, components are top-level keys with a 'path:' child
components=()
current_key=""
while IFS= read -r line; do
  # Top-level key (no leading space, has colon)
  if echo "$line" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_-]*:'; then
    current_key=$(echo "$line" | sed 's/^\([a-zA-Z_][a-zA-Z0-9_-]*\):.*/\1/')
    # Skip the 'varp' key
    if [ "$current_key" = "varp" ]; then
      current_key=""
    fi
    continue
  fi
  # If we're in a top-level key and see 'path:', it's a component
  if [ -n "$current_key" ] && echo "$line" | grep -qE '^  path:'; then
    components+=("$current_key")
    current_key=""
  fi
done < "$MANIFEST"

comp_count=${#components[@]}
comp_list=$(IFS=', '; echo "${components[*]}")

echo "Varp project: v${project_version}"
echo "Components: ${comp_list} (${comp_count})"

# Check for stale docs
stale_docs=()
current_comp=""
current_path=""
in_docs=false
while IFS= read -r line; do
  # Top-level key
  if echo "$line" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_-]*:'; then
    key=$(echo "$line" | sed 's/^\([a-zA-Z_][a-zA-Z0-9_-]*\):.*/\1/')
    if [ "$key" != "varp" ]; then
      current_comp="$key"
      current_path=""
      in_docs=false
    fi
    continue
  fi
  # Component path
  if [ -n "$current_comp" ] && echo "$line" | grep -qE '^  path:'; then
    current_path=$(echo "$line" | sed 's/^  path:[[:space:]]*//')
  fi
  # Docs array start
  if [ -n "$current_comp" ] && echo "$line" | grep -qE '^  docs:'; then
    in_docs=true
    continue
  fi
  # Doc entry (list item: "    - ./path/to/doc.md")
  if $in_docs && echo "$line" | grep -qE '^    - '; then
    doc_path=$(echo "$line" | sed 's/^    - [[:space:]]*//')
    if [ -n "$current_path" ] && [ -f "$doc_path" ]; then
      # Find most recently modified source file in component path
      newest_source=$(find "$current_path" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' -o -name '*.go' -o -name '*.rs' \) -newer "$doc_path" 2>/dev/null | head -1)
      if [ -n "$newest_source" ]; then
        doc_basename=$(basename "$doc_path")
        stale_docs+=("${current_comp}/${doc_basename}")
      fi
    fi
    continue
  fi
  # Any non-list-item line after docs ends the docs block
  if $in_docs && ! echo "$line" | grep -qE '^    - |^$'; then
    in_docs=false
  fi
done < "$MANIFEST"

if [ ${#stale_docs[@]} -gt 0 ]; then
  stale_list=$(IFS=', '; echo "${stale_docs[*]}")
  echo "Stale docs: ${stale_list}"
fi

# Check for active plans
if [ -d "plans/in-progress" ]; then
  active_plans=()
  for plan_dir in plans/in-progress/*/; do
    if [ -d "$plan_dir" ]; then
      plan_name=$(basename "$plan_dir")
      active_plans+=("$plan_name")
    fi
  done
  if [ ${#active_plans[@]} -gt 0 ]; then
    for plan in "${active_plans[@]}"; do
      echo "Active plan: ${plan} (plans/in-progress/${plan}/)"
    done
  fi
fi
