#!/bin/bash
# Varp subagent-context hook
# Provides Varp awareness to spawned subagents

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# Output JSON with additionalContext for proper injection
cat <<'CONTEXT'
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "## Varp Project Conventions\n\nThis is a Varp-managed project (varp.yaml defines components, paths, dependencies, doc locations).\n\n**Stack**: Bun (runtime/test/install), TypeScript (ES2022), Zod (schema-first types), MCP SDK.\n\n**Key rules**:\n- Types: Define Zod schema first, infer via z.infer<>. Never define standalone interfaces.\n- Tests: Co-located *.test.ts files. Run with `bun test`.\n- Build: `bun run build` (tsc to build/).\n- MCP tools: Accept manifest_path param, parse internally, return JSON as text content.\n- Hooks: No runtime deps (no jq/python). grep/sed only. Exit 0 when varp.yaml missing.\n- Skills: YAML frontmatter required (name + description).\n\n**Module structure**: src/manifest/ (parser, resolver, freshness, graph), src/scheduler/ (hazards, waves, critical-path), src/plan/ (parser, validator), src/enforcement/ (capabilities, restart).\n\nIf you modify component files, note which components were affected in your response."
  }
}
CONTEXT
