# Hooks

Lifecycle hooks for varp-managed sessions.

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Inject project state summary and cost tracking status into session context |
| `freshness-track.sh` | PostToolUse (Write/Edit) | Report which component a modified file belongs to |
| `auto-format.sh` | PostToolUse (Write/Edit) | Run oxfmt + oxlint --fix on modified `.ts` files |
| `subagent-context.sh` | SubagentStart | Inject project conventions into subagent context |
| *(prompt hook)* | Stop | Run `varp_lint` to check for stale docs, broken links, missing deps |

## session-start.sh

Parses `varp.yaml` to display project version, component list, stale docs, broken links, and active plans. Also reports cost tracking status — detects both the statusline cost file (`/tmp/claude/varp-cost.json`) and OpenTelemetry configuration (`CLAUDE_CODE_ENABLE_TELEMETRY`, `OTEL_METRICS_EXPORTER`, `OTEL_EXPORTER_OTLP_ENDPOINT`).

Output example:
```
Varp project: v0.3
Components: shared, server, manifest, plan, scheduler, enforcement
Cost tracking: statusline ✓ | otel ✓ (otlp → localhost:4317)
```

## freshness-track.sh

Lightweight component detection. When a Write or Edit touches a source file within a component's path, reports the component name. Skips `.md` files (doc edits don't trigger freshness concerns). No filesystem scanning — just YAML parse + prefix match.

Output example:
```
Varp: modified component "manifest"
```

Exits silently when the file is outside any component or is a markdown file.

## auto-format.sh

Runs `oxfmt --write` and `oxlint --fix` on TypeScript files after Write/Edit. Extracts the file path from the JSON context on stdin, filters for `.ts` extension, and checks file existence before formatting. Errors from formatters are silently swallowed (`|| true`) — formatting is best-effort, not blocking.

## Conventions

- No runtime dependencies (no jq/python) — parse with grep/sed/awk and bash parameter expansion
- Exit 0 when `varp.yaml` is missing (graceful degradation)
- Hook JSON output via `hooks.json` using nested `hooks` array format
- All scripts pass `shellcheck` (enforced by `bun run check`)
