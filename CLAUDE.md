# CLAUDE.md

Multi-agent code quality analyzer. 7 AI agents (Claude) analyze code in parallel across quality dimensions, produce weighted score.

Three surfaces: **CLI** (Bun), **GitHub Action** (Node.js), **Web Dashboard** (Next.js).

## Structure

```
apps/cli/           # Bun CLI (primary interface)
apps/web/           # Next.js dashboard (Clerk auth, Stripe billing, Prisma/PostgreSQL)
apps/action/        # GitHub Action wrapper (Node.js runtime)
packages/core/      # Orchestration engine + agent definitions
packages/types/     # Shared TypeScript interfaces
packages/config/    # Shared tsconfig
```

**Dependency flow**: apps → core → types
**Build order** (Turborepo): types → core → apps (parallel)

## Commands

```bash
bun run build              # All packages (dependency order)
bun run test               # All tests
bun run lint               # All packages

cd apps/cli && bun run dev <path>     # Run CLI
cd apps/web && bun run dev            # Dashboard dev server
cd packages/core && bun run dev       # Watch mode

cd apps/web && bun run db:generate    # After schema changes
cd apps/web && bun run db:push        # Push schema (dev)
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

## Critical: Dual Discovery

Two file discovery implementations exist:
- `packages/core/src/discovery.ts` — Bun-specific (`import { Glob } from "bun"`)
- `packages/core/src/discovery-node.ts` — Node.js (`glob` package)

**When modifying discovery, update BOTH files.** GitHub Action runs Node.js, not Bun.

## Web Dashboard Patterns

- **Auth**: Clerk (GitHub OAuth + email)
- **DB**: Prisma ORM + PostgreSQL (Neon). Import from `@/lib/db` (singleton).
- **Payments**: Stripe (Free/Pro $39/Team $249)
- **Rate limiting**: Upstash Redis on all public endpoints
- **Env vars**: Validated via `@t3-oss/env-nextjs` in `lib/env.ts`
- **Webhooks**: Signature verified (Clerk via Svix, Stripe via SDK)
- **API keys**: bcrypt hashed, constant-time comparison
- **Components**: Server Components by default, `"use client"` only when needed

Schema: `apps/web/prisma/schema.prisma`. After changes: `db:push` → `db:generate` → `build`.

## Common Tasks

**New agent**: Create in `packages/core/src/agents/`, export from `index.ts`, rebalance all weights to sum 1.0.

**New API endpoint**: `apps/web/app/api/<path>/route.ts`, add rate limiting if public, validate with Zod.

**Schema change**: Edit `schema.prisma` → `db:push` → `db:generate` → rebuild.

**Build errors**: Run `bun run build` from root. Prisma errors: `cd apps/web && bun run db:generate`.
