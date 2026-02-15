# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

AI Code Auditor is a **multi-agent code quality analysis tool** built as a Turborepo monorepo. It uses 5 specialized AI agents (powered by Claude) to analyze code across different quality dimensions in parallel, then synthesizes a weighted overall quality score.

**Development model**: This project uses **Agent Driven Development (ADD)** - AI agents orchestrated by Claude build and maintain the codebase. See `docs/agent-driven-development/` for the full orchestration plan.

## Monorepo Structure

```
ai-code-auditor/
├── apps/
│   ├── cli/              # Bun-based CLI tool (primary user interface)
│   ├── web/              # Next.js dashboard (team collaboration)
│   └── action/           # GitHub Action wrapper
└── packages/
    ├── core/             # Multi-agent orchestration engine
    ├── types/            # Shared TypeScript types
    └── config/           # Shared TypeScript config
```

**Dependency flow**: CLI/Web/Action → core → types

**Key constraint**: `packages/core` has TWO discovery implementations:
- `discovery.ts` - Bun-specific (uses `import { Glob } from "bun"`)
- `discovery-node.ts` - Node.js-compatible (uses `glob` package)

The CLI uses Bun's native APIs, but the GitHub Action must use Node.js compatible code.

## Build System

**Package manager**: Bun (required for CLI development)
**Build orchestration**: Turborepo with caching

```bash
# Root commands (run all workspaces)
bun run build          # Build all packages (respects dependency order)
bun run test           # Run all tests
bun run lint           # Lint all packages
bun run clean          # Clean all build artifacts

# Package-specific commands
cd apps/cli
bun run dev <path>     # Run CLI in development
bun run build          # Build CLI bundle
bun run build:binaries # Build platform-specific executables
bun test               # Run CLI tests

cd apps/web
bun run dev            # Start Next.js dev server
bun run build          # Production build
bun run db:generate    # Generate Prisma client
bun run db:push        # Push schema to database
bun test               # Vitest unit tests
bun run test:e2e       # Playwright e2e tests

cd packages/core
bun run build          # Compile TypeScript
bun run dev            # Watch mode
```

**Build order enforced by Turborepo**:
1. `packages/types` (no dependencies)
2. `packages/core` (depends on types)
3. `apps/cli`, `apps/web`, `apps/action` (depend on core)

## Multi-Agent Architecture

**Core concept**: Five specialized agents analyze code in parallel, each focusing on a specific quality dimension.

### Agent Definitions

Each agent lives in `packages/core/src/agents/<name>.ts` and implements:

```typescript
interface AgentDefinition {
  name: string                                    // e.g., "correctness"
  weight: number                                  // Must sum to 1.0 across all agents
  systemPrompt: string                            // LLM instructions
  userPromptTemplate: (files: FileContent[]) => string
  parseResponse: (raw: string) => AgentResult
}
```

**Current agents** (from `packages/core/src/agents/index.ts`):
1. **Correctness** (25%) - Logic errors, type safety, null handling, API usage
2. **Security** (25%) - SQL injection, XSS, auth issues, crypto weaknesses
3. **Performance** (15%) - Algorithmic complexity, memory leaks, DB queries
4. **Maintainability** (20%) - Code complexity, documentation, error handling
5. **Edge Cases** (15%) - Boundary conditions, race conditions, resource limits

**Weight validation**: On module load, validates that `sum(agent.weight) === 1.0` (within floating point tolerance)

### Orchestration Flow

The orchestrator (`packages/core/src/orchestrator.ts`) implements:

```typescript
async function runAudit(files: FileContent[], options) {
  // 1. Run all agents in parallel using Promise.allSettled
  const results = await Promise.allSettled(
    agents.map(agent => runAgent(agent, files, options))
  )

  // 2. Even if some agents fail, continue with successful ones
  // 3. Calculate weighted average score
  const overallScore = calculateOverallScore(results)
}
```

**Key design decisions**:
- Uses `Promise.allSettled` (not `Promise.all`) so one agent failure doesn't abort entire audit
- Each agent gets the same files but analyzes independently
- Failed agents return score=0 with error findings
- Overall score uses weighted average: `sum(score * weight) / sum(weights)`

### CLI Flow

Full execution path (`apps/cli/src/cli.ts`):

```
1. Parse args → 2. Load config → 3. Validate API key
→ 4. Discover files → 5. Chunk files (if needed)
→ 6. Run multi-agent audit → 7. Synthesize report
→ 8. Print to terminal → 9. Save to file (if --output)
→ 10. Sync to dashboard (if API key configured)
```

**File discovery**: Uses `.gitignore` patterns to exclude files
**Chunking**: Splits large codebases into chunks based on token limit (default 100k tokens)
**Configuration**: Reads `.code-audit.json` from project root, merged with CLI flags

## Web Dashboard

**Framework**: Next.js 14 App Router with TypeScript strict mode
**Auth**: Clerk (handles GitHub OAuth and email)
**Database**: PostgreSQL via Prisma ORM
**Payments**: Stripe with 3 tiers (Free/Pro/Team)
**Rate limiting**: Upstash Redis

### Key Patterns

**Environment validation** (`apps/web/lib/env.ts`):
- Uses `@t3-oss/env-nextjs` for type-safe env vars
- Validates on startup, crashes if missing required vars
- Server vars never leak to client

**API routes** (`apps/web/app/api/*/route.ts`):
- All public endpoints use rate limiting
- Webhook routes verify signatures (Clerk uses Svix, Stripe uses native)
- API keys are hashed with bcrypt, never stored plain

**Database schema** (`apps/web/prisma/schema.prisma`):
- Cascade deletes: Team → Members, Audits, ApiKeys
- Audit → Findings
- Indexes on common queries: `[teamId, createdAt]`, `[auditId]`

**Prisma workflow**:
```bash
# After schema changes
bun run db:push        # Push to database
bun run db:generate    # Regenerate Prisma client
bun run build          # Rebuild (imports new types)
```

### Dashboard Integration

The CLI can optionally sync results to the dashboard:

1. User runs `code-audit login` → saves API key to `~/.code-audit-credentials`
2. CLI includes API key in `Authorization: Bearer <key>` header
3. POST to `/api/cli/audit` with audit results
4. API validates key (bcrypt compare), creates Audit + Finding records
5. CLI prints dashboard URL for viewing results

## Testing

**Unit tests** (Vitest):
- Located in `apps/web/test/`
- Run with `cd apps/web && bun test`
- Coverage reports: `bun run test:coverage`

**E2E tests** (Playwright):
- Located in `apps/web/e2e/`
- Run with `cd apps/web && bun run test:e2e`
- Test critical user journeys (login, creating audits, API keys, billing)

**Test database**: Uses separate DATABASE_URL for test environment (see `.env.test`)

## Common Tasks

**Adding a new agent**:
1. Create `packages/core/src/agents/<name>.ts` implementing `AgentDefinition`
2. Export from `packages/core/src/agents/index.ts`
3. Adjust weights in all agents (must sum to 1.0)
4. Update README.md with new agent description

**Adding a new API endpoint**:
1. Create `apps/web/app/api/<path>/route.ts`
2. Implement `POST`, `GET`, etc. as named exports
3. Add rate limiting if public endpoint
4. Validate request body with Zod
5. Add corresponding test in `apps/web/e2e/`

**Updating database schema**:
1. Edit `apps/web/prisma/schema.prisma`
2. Run `bun run db:push` (development) or create migration (production)
3. Run `bun run db:generate` to update Prisma client
4. Rebuild packages that import Prisma types

**Building CLI binaries**:
```bash
cd apps/cli
bun run build:binaries    # Builds all platforms
# Or individual platforms:
bun run build:darwin-arm64
bun run build:linux-x64
```

**TypeScript errors after refactoring**:
- First rebuild all packages: `bun run build` (from root)
- Turbo respects dependency order, so types/core rebuild before apps
- If web build fails with Prisma errors, regenerate client: `cd apps/web && bun run db:generate`

## Important Constraints

**Cross-platform compatibility**:
- `packages/core` exports Node.js-compatible code only
- Bun-specific code (`discovery.ts`) excluded from TypeScript compilation
- GitHub Action runs on Node.js, not Bun

**Environment variables**:
- CLI requires `ANTHROPIC_API_KEY` (fails with helpful message if missing)
- Web dashboard validates all env vars on startup via `lib/env.ts`
- Never commit `.env` files (already in `.gitignore`)

**Webhook security**:
- Clerk webhooks: verify signature with `svix` library
- Stripe webhooks: verify signature with Stripe SDK
- Both check `WEBHOOK_SECRET` env vars

**API key security**:
- Always hash with bcrypt before storing
- Use constant-time comparison when validating
- Never log or return unhashed keys

**Prisma usage**:
- Import from `@/lib/db` (singleton), not `@prisma/client` directly
- Prevents multiple Prisma client instances in development

## Development Workflow

**Starting fresh**:
```bash
git clone <repo>
bun install                    # Install all workspace dependencies
cp apps/web/.env.example apps/web/.env
# Edit .env with real credentials
cd apps/web && bun run db:generate
cd ../.. && bun run build      # Build all packages
```

**Daily development**:
```bash
# Terminal 1 (if working on CLI)
cd apps/cli
bun run dev <path-to-test>

# Terminal 2 (if working on web)
cd apps/web
bun run dev

# Terminal 3 (if working on core package)
cd packages/core
bun run dev                     # Watch mode
```

**Before committing**:
```bash
bun run build                   # Verify all packages build
bun run test                    # Run all tests
```

**Vercel deployment** (web dashboard):
- Connected to GitHub, auto-deploys on push to `main`
- Environment variables configured in Vercel dashboard
- Build command: `cd apps/web && bun run build`
- Monorepo settings in `vercel.json` at root

## Documentation

**For AI agents**: Start with `docs/AGENT-GUIDE.md` - comprehensive reference for working on this project

**For orchestration**: See `docs/agent-driven-development/` for Agent Driven Development methodology:
- `README.md` - What is ADD, key principles
- `PRIORITIZATION.md` - Complete orchestration plan with dependency graph
- `SOFTWARE-PRACTICES.md` - Development practices for AI agent teams
- `backlog/PLAN-*.md` - Detailed implementation plans for each feature

**For architecture**: See `docs/ARCHITECTURE.md` for multi-agent system design
