# Agent Driven Development (ADD)

AI agents orchestrated by Claude build this codebase.

## Principles

1. **Agents by scope** — Specialize by codebase area (apps/web, apps/cli, packages/core), not role
2. **Role injection** — Same agent switches roles (Builder → Tester → Reviewer) via prompt
3. **Dependency graph** — Topological sort for ordering, value ranking for tie-breaking, parallel when independent
4. **CI/CD as coordinator** — Automated quality gates, no ceremonies

## vs Traditional Development

| Aspect | Human Teams | ADD |
|--------|-------------|-----|
| Planning | Sprints, standups | Dependency graph |
| Coordination | Meetings, Slack | CI/CD feedback |
| Parallelization | 2-3 humans | Unlimited agents |
| Context | Tribal knowledge | Resumable agent context |
| Documentation | Often neglected | Mandatory after every task |

## Docs

- **[PRIORITIZATION.md](./PRIORITIZATION.md)** — Current roadmap + dependency graph
- **[backlog/PLAN-*.md](./backlog/)** — Future implementation plans
- **[archive/PLAN-*.md](./archive/)** — Completed plans
