#!/bin/bash
# Varp subagent-context hook
# Reads conventions from .claude/rules/subagent-conventions.md and injects into subagent context

set -euo pipefail

MANIFEST="varp.yaml"
CONVENTIONS=".claude/rules/subagent-conventions.md"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# Exit silently if conventions file missing
if [ ! -f "$CONVENTIONS" ]; then
  exit 0
fi

# Read file and escape for JSON embedding using awk
content=$(awk '
  BEGIN { ORS="" }
  {
    gsub(/\\/, "\\\\")
    gsub(/"/, "\\\"")
    gsub(/\t/, "\\t")
    if (NR > 1) printf "\\n"
    print
  }
' "$CONVENTIONS")

# Output JSON with additionalContext
printf '{"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"%s"}}\n' "$content"
