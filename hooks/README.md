# Hooks

Lifecycle hooks for varp-managed sessions.

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Inject project state summary into session context |
| `freshness-track.sh` | PostToolUse (Write/Edit) | Flag stale docs when source files change |
| `subagent-context.sh` | SubagentStart | Inject project conventions into subagent context |

## Conventions

- No runtime dependencies (no jq/python) — parse with grep/sed/awk
- Exit 0 when `varp.yaml` is missing (graceful degradation)
- Hook JSON output via `hooks.json` using nested `hooks` array format
