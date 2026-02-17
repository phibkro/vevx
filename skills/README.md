# Skills

Four prompt-based skills for the varp orchestration lifecycle.

| Skill | Trigger | Purpose |
|-------|---------|---------|
| `/varp:plan` | Feature request or task decomposition | Produce `plan.xml` with touches, budgets, contracts |
| `/varp:execute` | Approved plan ready for implementation | Dispatch tasks to subagents with capability enforcement |
| `/varp:review` | Wave or plan completion | Diff expected vs actual, surface decisions |
| `/varp:status` | Anytime | Snapshot of components, freshness, active plans |

## Conventions

- Each skill is a `SKILL.md` file with YAML frontmatter (`name` + `description`)
- Skills are prompt-only — no code, no runtime dependencies
- Skills reference varp MCP tools by name (e.g., `varp_read_manifest`)
- Plans are stored in project memory (`~/.claude/projects/<project>/memory/plans/`), not the repo
