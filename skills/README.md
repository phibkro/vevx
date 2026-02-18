# Skills

Five prompt-based skills for the varp orchestration lifecycle.

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `/varp:init` | New project onboarding | Scaffold `varp.yaml` by scanning project structure and imports |
| `/varp:plan` | Feature request or task decomposition | Produce `plan.xml` with touches, budgets, contracts |
| `/varp:execute` | Approved plan ready for implementation | Dispatch tasks to subagents with capability enforcement. Outputs a status snapshot (freshness + lint) on plan completion. |
| `/varp:review` | Wave or plan completion | Diff expected vs actual via `varp_parse_log`, track doc changes via `varp_watch_freshness`, visualize deps via `varp_render_graph`. Appends project status snapshot. |
| `/varp:status` | Anytime | Snapshot of components, freshness, dependency graph (`varp_render_graph`), active plan progress (`varp_parse_log`) |

## Monorepo Tool Integration

When Nx, Turborepo, or moon is detected, skills leverage their graph data:

- **init** imports the existing dependency graph instead of re-inferring it
- **plan** suggests dependency-aware test runners (`turbo run test --filter=...`, `nx affected --target=test`) for verification commands
- **execute** cross-checks task impact against declared `touches` using `nx affected` or `turbo query` (advisory, not blocking)

## Conventions

- Each skill is a `SKILL.md` file with YAML frontmatter (`name` + `description`)
- Skills are prompt-only — no code, no runtime dependencies
- Skills reference varp MCP tools by name (e.g., `varp_read_manifest`)
- Plans are stored in project memory (`~/.claude/projects/<project>/memory/plans/`), not the repo
- Completed plans are auto-archived to `plans/archive/` by the execute skill
