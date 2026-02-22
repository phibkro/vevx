# Varp Plugin

Claude Code plugin distribution for varp. Provides skills (prompt-based workflows) and hooks (lifecycle scripts) that integrate the varp MCP server into Claude Code sessions.

The MCP server itself is configured separately in `.mcp.json` at the project root — the plugin only provides skills and hooks.

## Registration

```bash
claude plugin add packages/plugin
```

## Skills

Six prompt-based skills for the varp orchestration lifecycle. Skill names omit the `varp-` prefix — the plugin's namespace (`/varp:`) provides it automatically.

| Skill | Purpose |
|-------|---------|
| `/varp:init` | Scaffold `varp.yaml` by scanning project structure, imports, and docs |
| `/varp:plan` | Produce `plan.xml` with touches declarations and contracts |
| `/varp:execute` | Dispatch tasks to subagents with capability enforcement |
| `/varp:review` | Diff expected vs actual outcomes via execution log |
| `/varp:status` | Snapshot of components, freshness, dependency graph, plan progress |
| `/varp:coupling` | Surface coupling diagnostics for files or components being worked on |

All skills declare `allowed-tools: mcp__varp__*` to auto-approve varp MCP tool calls.

See `skills/README.md` for details on monorepo tool integration and conventions.

## Hooks

Lifecycle hooks that inject graph-derived structural awareness into sessions.

| Hook | Event | Purpose |
|------|-------|---------|
| `session-start.sh` | SessionStart | Inject coupling hotspots, freshness state, component health |
| `freshness-track.sh` | PostToolUse (Write/Edit) | Report owning component + coupling neighborhood for modified files |
| `auto-format.sh` | PostToolUse (Write/Edit) | Run oxfmt + oxlint --fix on modified `.ts` files |
| `subagent-context.sh` | SubagentStart | Inject project conventions into subagent context |
| `session-stop.sh` | Stop | Summarize session impact: modified components, coupling warnings |
| *(prompt hook)* | Stop | Run `varp_lint` to check for stale docs, broken links |

See `hooks/README.md` for output examples and conventions.

## Conventions

- Skills are `SKILL.md` files with YAML frontmatter — prompt-only, no code
- Hooks have no runtime dependencies (no jq/python) — parse with grep/sed/awk
- Hook scripts pass `shellcheck` (enforced by `bun run check` in core)
- Graph data flows from `.varp/summary.json` cache (written by CLI, read by hooks)
- Skills and hooks specs change frequently — check `docs/reference-urls.md` before modifying
