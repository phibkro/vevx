# Hooks

Lifecycle hooks for varp-managed sessions.

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Inject project state summary into session context |
| `freshness-track.sh` | PostToolUse (Write/Edit) | Report which component a modified file belongs to |
| `subagent-context.sh` | SubagentStart | Inject project conventions into subagent context |

## freshness-track.sh

Lightweight component detection. When a Write or Edit touches a source file within a component's path, reports the component name. Skips `.md` files (doc edits don't trigger freshness concerns). No filesystem scanning — just YAML parse + prefix match.

Output example:
```
Varp: modified component "manifest"
```

Exits silently when the file is outside any component or is a markdown file.

## Conventions

- No runtime dependencies (no jq/python) — parse with grep/sed/awk and bash parameter expansion
- Exit 0 when `varp.yaml` is missing (graceful degradation)
- Hook JSON output via `hooks.json` using nested `hooks` array format
- All scripts pass `shellcheck` (enforced by `bun run check`)
