# Project Constitution

Injected to all subagents via SubagentStart hook.

## Conventions

- **Bun** for package management and CLI runtime
- **Agent weights must sum to 1.0**
- **Dual discovery**: `discovery.ts` (Bun) and `discovery-node.ts` (Node.js) — update BOTH when modifying

## After Every Task

1. Verify: tests, lint, build pass
2. Document: update docs if behavior/architecture changed
3. Commit: conventional format
