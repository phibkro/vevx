# Agent Guide

Complete reference for AI agents working on this project.

## What This Is

AI Code Auditor is a **multi-agent code quality tool**. Five specialized AI agents analyze code in parallel across different quality dimensions (correctness, security, performance, maintainability, edge cases), then synthesize results into a comprehensive report.

**Development model**: This project uses **Agent Driven Development (ADD)** - AI agents orchestrated by Claude build and maintain the codebase. See [agent-driven-development/](./agent-driven-development/) for the full orchestration plan.

## First Steps

```bash
# 1. Install dependencies
bun install

# 2. Build all packages
bun run build

# 3. Run CLI locally
cd apps/cli && bun run dev src/

# 4. Run tests
bun test
```

## Key Files to Read

**Start here**:
1. `CLAUDE.md` - Comprehensive AI assistant guidance
2. `.claude/rules/constitution.md` - Project tech stack and conventions
3. This file

**Architecture**:
- `packages/core/src/orchestrator.ts` - Runs agents in parallel
- `packages/core/src/agents/index.ts` - Agent definitions
- `packages/core/src/agents/*.ts` - Individual agents

**Entry points**:
- `apps/cli/src/cli.ts` - CLI entry point
- `apps/action/src/index.ts` - GitHub Action entry point
- `apps/web/app/api/cli/audit/route.ts` - Dashboard API

## Project Structure

```
├── packages/
│   ├── core/          # Multi-agent orchestration engine ⭐
│   ├── types/         # Shared TypeScript types
│   └── api-client/    # Dashboard API client
├── apps/
│   ├── cli/           # Bun-based CLI tool
│   ├── web/           # Next.js dashboard
│   └── action/        # GitHub Action (Node.js)
└── docs/              # Documentation
```

**Dependency flow**: CLI/Web/Action → core → types

## Common Commands

```bash
# Build (respects dependency order)
bun run build                   # All packages
cd apps/cli && bun run build    # Just CLI
cd apps/web && bun run build    # Just web

# Test
bun test                        # All tests
cd apps/web && bun test         # Web unit tests
cd apps/web && bun run test:e2e # Web e2e tests
cd apps/web && bun run test:coverage # Coverage report

# Lint
bun run lint                    # All packages

# Development
cd apps/cli && bun run dev <path>   # Run CLI
cd apps/web && bun run dev          # Run dashboard
cd packages/core && bun run dev     # Watch mode for core

# Database (apps/web)
cd apps/web && bun run db:generate  # After schema changes
cd apps/web && bun run db:push      # Push schema (dev only)
cd apps/web && bun run db:studio    # Open Prisma Studio
```

## Key Concepts

### Multi-Agent Architecture

**Five specialized agents** analyze code in parallel:
1. **Correctness** (25%) - Logic errors, type safety
2. **Security** (25%) - Vulnerabilities, auth issues
3. **Performance** (15%) - Complexity, memory leaks
4. **Maintainability** (20%) - Code quality, docs
5. **Edge Cases** (15%) - Boundary conditions, race conditions

**Agent weights must sum to 1.0** (validated on module load)

### Orchestration Flow

```
User Input → File Discovery → Chunking
  ↓
Promise.allSettled (parallel agents)
  ↓
AgentResult[] → Weighted Score → Report
  ↓
Terminal | Markdown | Dashboard
```

**Key decision**: `Promise.allSettled` (not `Promise.all`) ensures failed agents don't abort entire audit

### Platform-Specific Code (CRITICAL)

**Two discovery implementations**:
- `discovery.ts` - Bun-specific (uses `import { Glob } from "bun"`)
- `discovery-node.ts` - Node.js compatible (uses `glob` package)

**Why**: GitHub Actions run in Node.js, not Bun. The CLI uses Bun's native APIs for performance.

**Important**: When modifying file discovery, update BOTH files to maintain compatibility.

## Adding Features

### New Agent (packages/core)
1. Create `packages/core/src/agents/<name>.ts`
2. Export from `packages/core/src/agents/index.ts`
3. **Adjust ALL agent weights** to sum to 1.0
4. Add tests
5. Update README.md

### New API Endpoint (apps/web)
1. Create `apps/web/app/api/<path>/route.ts`
2. Add rate limiting if public
3. Validate input with Zod
4. Add tests in `apps/web/test/api/`

### Database Schema Change (apps/web)
1. Edit `apps/web/prisma/schema.prisma`
2. Run `cd apps/web && bun run db:generate`
3. Rebuild packages importing Prisma types

## Environment Variables

### CLI (apps/cli)
```bash
ANTHROPIC_API_KEY=sk-ant-...        # Required for analysis
CODE_AUDITOR_API_KEY=...            # Optional (dashboard sync)
CODE_AUDITOR_API_URL=...            # Optional (default: production)
```

### Web Dashboard (apps/web)
See `apps/web/.env.example` for complete list. Key variables:

```bash
# Database
DATABASE_URL=postgresql://...

# Authentication (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=whsec_...

# Payments (Stripe)
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...

# Rate Limiting (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

## Build System

**Turborepo** with caching:
- Build order: types → core/api-client → cli/web/action
- Parallel builds for independent packages
- Cache hits show ">>> FULL TURBO"

**If TypeScript errors after refactoring**:
```bash
bun run build  # Rebuilds all in correct order
```

## Testing Strategy

**Unit tests**: Business logic, utilities
- Vitest for all packages
- Run: `bun test`

**Integration tests**: API endpoints
- Mock database with `vi.mock()`
- Web tests: `cd apps/web && bun test`

**E2E tests**: Critical user journeys
- Playwright for web dashboard
- Run: `cd apps/web && bun run test:e2e`

## Troubleshooting

### Build Failures

**Error**: `Cannot find module '@code-auditor/core'`
```bash
# Fix: Build dependencies first
cd packages/core && bun run build
```

**Error**: `Module '@prisma/client' has no exported member 'X'`
```bash
# Fix: Regenerate Prisma client
cd apps/web && bun run db:generate
```

**General build issues**:
```bash
# Clean and rebuild everything
bun run clean && bun run build
```

### Test Failures

**Vitest mocking errors with `db`**:
- Use async factory functions in `vi.mock()`
- See existing tests for patterns

**TypeScript errors in tests**:
```bash
# Rebuild all packages in correct order
bun run build
```

### Runtime Errors

**Error**: `ANTHROPIC_API_KEY not configured`
```bash
# Fix: Set environment variable
export ANTHROPIC_API_KEY='your-key'
```

**Error**: `Dynamic server usage: Route couldn't be rendered statically`
- This is expected for API routes using `headers()` - not an error

## Important Constraints

1. **Agent weights must sum to 1.0**
2. **CLI uses Bun APIs** - `discovery.ts` excluded from Action build
3. **Web uses Server Components** by default - add `"use client"` only when needed
4. **All public APIs need rate limiting**
5. **API keys are bcrypt hashed** - never store plain text

## Next Steps

After reading this guide:
1. Read `CLAUDE.md` for complete project context
2. Read `docs/ARCHITECTURE.md` for deep dive on product design
3. Check `docs/agent-driven-development/` for orchestration plans
4. Pick a task from PRIORITIZATION.md and start coding!
