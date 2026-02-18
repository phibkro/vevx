# CLAUDE.md

Compliance-focused code auditing tool (evolving from generic code review). Multi-agent orchestration analyzes full codebases against compliance frameworks.

## Structure

```
packages/core/      # Orchestration engine, agents, API client
apps/cli/           # Bun CLI (primary interface)
rulesets/           # Compliance framework definitions (OWASP Top 10)
docs/               # Design documents and research
```

**Dependency flow**: cli → core
**Build** (Turborepo): core → cli

## Commands

```bash
bun run build              # All packages (dependency order)
bun run test               # All tests
bun run lint               # All packages

cd apps/cli && bun run dev <path>     # Run CLI
cd packages/core && bun run dev       # Watch mode
cd apps/cli && bun run build:binaries # Platform executables
```

## Agent Architecture

Agents defined in `packages/core/src/agents/<name>.ts`. Each has `name`, `weight`, `systemPrompt`, `userPromptTemplate`, `parseResponse`.

| Agent | Weight | Focus |
|-------|--------|-------|
| Correctness | 22% | Logic errors, type safety, null handling |
| Security | 22% | Injection, XSS, auth, crypto |
| Maintainability | 15% | Complexity, documentation, error handling |
| Performance | 13% | Algorithmic complexity, memory, DB queries |
| Edge Cases | 13% | Boundaries, race conditions, resource limits |
| Accessibility | 10% | WCAG, keyboard nav, screen readers |
| Documentation | 5% | JSDoc/TSDoc, API docs |

Weights **must sum to 1.0** (validated on module load). `dependency-security` agent exists but disabled (weight 0).

Orchestrator (`packages/core/src/orchestrator.ts`) runs all agents via `Promise.allSettled` — one failure doesn't abort the audit. Score = weighted average.

## Dual Discovery

Two file discovery implementations exist:
- `packages/core/src/discovery.ts` — Bun-specific (`import { Glob } from "bun"`)
- `packages/core/src/discovery-node.ts` — Node.js (`glob` package)

**When modifying discovery, update BOTH files.** CLI uses Bun version, core exports Node version.

## Common Tasks

**New agent**: Create in `packages/core/src/agents/`, export from `index.ts`, rebalance all weights to sum 1.0.

**Build errors**: Run `bun run build` from root.
