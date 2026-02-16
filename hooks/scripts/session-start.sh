#!/bin/bash
# Varp session-start hook
# Outputs project summary when varp.yaml is present

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# Parse project name and version
project_name=$(grep '^name:' "$MANIFEST" | sed 's/^name:[[:space:]]*//')
project_version=$(grep '^varp:' "$MANIFEST" | sed 's/^varp:[[:space:]]*//')

# Parse component names (lines matching "^  <name>:" under components)
components=()
in_components=false
while IFS= read -r line; do
  if echo "$line" | grep -q '^components:'; then
    in_components=true
    continue
  fi
  if $in_components; then
    # A top-level key (no leading space) ends the components block
    if echo "$line" | grep -q '^[^[:space:]]'; then
      break
    fi
    # Component entries have exactly 2 spaces of indent followed by name:
    if echo "$line" | grep -qE '^  [a-zA-Z_][a-zA-Z0-9_-]*:'; then
      comp=$(echo "$line" | sed 's/^  \([a-zA-Z_][a-zA-Z0-9_-]*\):.*/\1/')
      components+=("$comp")
    fi
  fi
done < "$MANIFEST"

comp_count=${#components[@]}
comp_list=$(IFS=', '; echo "${components[*]}")

echo "Varp project: ${project_name} (v${project_version})"
echo "Components: ${comp_list} (${comp_count})"

# Check for stale docs (source files newer than doc files)
stale_docs=()
in_components=false
current_comp=""
current_path=""
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
    fi
    # Doc entries (6 spaces indent)
    if echo "$line" | grep -qE '^      [a-zA-Z_][a-zA-Z0-9_-]*:'; then
      doc_path=$(echo "$line" | sed 's/^      [a-zA-Z_][a-zA-Z0-9_-]*:[[:space:]]*//')
      doc_name=$(echo "$line" | sed 's/^      \([a-zA-Z_][a-zA-Z0-9_-]*\):.*/\1/')
      if [ -n "$current_path" ] && [ -f "$doc_path" ]; then
        # Find most recently modified source file in component path
        newest_source=$(find "$current_path" -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.js' -o -name '*.jsx' -o -name '*.py' -o -name '*.go' -o -name '*.rs' \) -newer "$doc_path" 2>/dev/null | head -1)
        if [ -n "$newest_source" ]; then
          stale_docs+=("${current_comp}/${doc_name}.md")
        fi
      fi
    fi
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
