# Hooks

Lifecycle hooks for varp-managed sessions. Hooks inject graph-derived structural awareness into the session lifecycle.

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Inject graph context: coupling hotspots, freshness state, component health |
| `freshness-track.sh` | PostToolUse (Write/Edit) | Report owning component + coupling neighborhood for modified files |
| `subagent-context.sh` | SubagentStart | Inject project conventions into subagent context |
| `session-stop.sh` | Stop | Summarize session impact: modified components, coupling warnings, file count |
| *(prompt hook)* | Stop | Run `varp_lint` to check for stale docs, broken links, missing deps |

## session-start.sh

Delegates to `varp summary` CLI for graph-aware project health. When the CLI is built, injects coupling hotspots (hidden coupling between components), freshness state (stale doc count), and component list. Falls back to basic `grep -c` component counting when CLI is unavailable.

Output example:
```
Components (12): shared, analysis, mcp, manifest, plan, scheduler, enforcement, execution, skills, hooks, audit, cli
Docs: 4/12 stale
Hidden coupling (3):
  audit <-> cli  weight=5.28
  hooks <-> skills  weight=2.54
  plan <-> scheduler  weight=2.34
```

## freshness-track.sh

Reports which component a modified file belongs to. When `.varp/summary.json` exists (written by `varp summary` at session start), also checks if the file is in a coupling hotspot and notes co-changing files.

Output example:
```
Note: Modified file in component "audit" scope.
Coupling note: files that typically co-change: packages/audit/src/planner/index.ts (0.37)
```

Exits silently when the file is outside any component, is a markdown file, or has no coupling data.

## session-stop.sh

Summarizes session impact at session end. Maps modified files (staged + unstaged) to components, reports which components were touched, and checks `.varp/summary.json` for coupling warnings involving modified components.

Output example:
```
Session impact: modified components: hooks, cli
Coupling warning: modified components with hidden coupling: cli
Consider running /varp:coupling to check for needed coordinated changes.
Files modified: 5
```

## Conventions

- No runtime dependencies (no jq/python) — parse with grep/sed/awk and bash parameter expansion
- Exit 0 when `varp.yaml` is missing (graceful degradation)
- All scripts pass `shellcheck` (enforced by `bun run check`)
- Graph data comes from `.varp/summary.json` cache (written by CLI, read by hooks)
