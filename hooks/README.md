# Hooks

Lifecycle hooks for varp-managed sessions.

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Inject project state summary into session context |
| `freshness-track.sh` | PostToolUse (Write/Edit) | List all stale docs when source files change |
| `subagent-context.sh` | SubagentStart | Inject project conventions into subagent context |

## freshness-track.sh

Detects when a Write or Edit touches a file within a component's path. Collects all docs for that component — explicit (from `docs:` in varp.yaml), auto-discovered (`{path}/README.md`, `{path}/docs/*.md`) — and compares each doc's mtime against the latest source file mtime. Reports all stale docs, not just the first.

Output example:
```
Note: Modified file in component "core" scope. The following docs may be stale:
  - src/manifest/README.md
  - src/plan/README.md
  - src/README.md
```

Exits silently when no docs are stale or the file is outside any component.

## Conventions

- No runtime dependencies (no jq/python) — parse with grep/sed/awk and bash parameter expansion
- Exit 0 when `varp.yaml` is missing (graceful degradation)
- Hook JSON output via `hooks.json` using nested `hooks` array format
- All scripts pass `shellcheck` (enforced by `bun run check`)
