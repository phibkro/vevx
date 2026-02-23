# Hooks

Lifecycle hooks for varp-managed sessions. Hooks inject graph-derived structural awareness into the session lifecycle.

| Hook                  | Event                     | Purpose                                                                      |
| --------------------- | ------------------------- | ---------------------------------------------------------------------------- |
| `session-start.sh`    | SessionStart              | Inject graph context, active plans, and cost tracking status                 |
| `tag-commits.sh`      | PreToolUse (Bash)         | Add `tags:` line to git commit messages from varp.yaml component mapping     |
| `freshness-track.sh`  | PostToolUse (Write\|Edit) | Report owning component + coupling neighborhood for modified files           |
| `subagent-context.sh` | SubagentStart             | Inject project conventions into subagent context                             |
| `session-stop.sh`     | Stop                      | Summarize session impact: modified components, coupling warnings, file count |
| _(prompt hook)_       | Stop                      | Run `varp_lint` to check for stale docs, broken links, missing deps          |

## session-start.sh

Delegates to `varp summary` CLI for graph-aware project health. When the CLI is built, injects coupling hotspots (hidden coupling between components), freshness state (stale doc count), and component list. Falls back to basic `grep -c` component counting when CLI is unavailable.

Also reports:
- **Active plans** — scans `~/.claude/projects/<key>/memory/plans/` for `plan.xml` files
- **Cost tracking status** — checks for statusline (`/tmp/claude/varp-cost.json`) and OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY`)

Output example:

```
Components (13): shared, analysis, mcp, manifest, plan, scheduler, enforcement, execution, skills, hooks, audit, cli, kart
Docs: 1/12 stale
Hidden coupling (3):
  audit <-> cli  weight=5.28
  hooks <-> skills  weight=2.54
  plan <-> scheduler  weight=2.34
Cost tracking: statusline ✗ | otel ✗
```

## tag-commits.sh

Intercepts `git commit -m` commands and appends a `tags:` line mapping staged files to varp.yaml components. This produces kiste-compatible commit metadata for tag-aware retrieval and co-change analysis.

The bash wrapper (`tag-commits.sh`) handles cheap early exits: no `varp.yaml`, not a git commit, `--amend`, or `tags:` already present. The TypeScript impl (`tag-commits-impl.ts`) does the actual manifest lookup via `parseManifest` + `findOwningComponent` from `@vevx/varp/lib`.

**Scoped to `-m` commits only.** Editor-based commits and `--amend` are skipped. This covers the common agent path.

Output example (injected into the commit command):

```
tags: manifest, shared
```

**Limitations:**
- Requires built varp library (`packages/varp/build/lib.js`)
- Only rewrites HEREDOC-style or Co-Authored-By commits (per project convention)
- Simple `-m "message"` without HEREDOC/Co-Authored-By is skipped

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

- No external runtime dependencies (no jq/python) — parse with grep/sed/awk and bash parameter expansion
- Bun is allowed for hooks that need structured data (YAML, manifest lookups) since it's the project runtime
- Exit 0 when `varp.yaml` is missing (graceful degradation)
- All scripts pass `shellcheck` (enforced by `bun run check`)
- Graph data comes from `.varp/summary.json` cache (written by CLI, read by hooks)
- Script paths use `CLAUDE_PLUGIN_ROOT` with dirname fallback: `PKG_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"`. This resolves correctly both when run as a plugin (cached by Claude Code) and directly from the repo.
