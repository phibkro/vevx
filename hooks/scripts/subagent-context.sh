#!/bin/bash
# Varp subagent-context hook
# Provides Varp awareness to spawned subagents

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

cat <<'EOF'
This is a Varp-managed project. Component documentation is maintained via the manifest (varp.yaml).
If you modify component files, note which components were affected in your response.
EOF
