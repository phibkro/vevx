# Development Guide

Developer documentation for contributing to AI Code Auditor.

## Prerequisites

- [Bun](https://bun.sh/) 1.0+
- Node.js 18+ (for deployment compatibility)
- PostgreSQL (for web dashboard development)

## Getting Started

```bash
# Clone repository
git clone https://github.com/yourusername/ai-code-auditor.git
cd ai-code-auditor

# Install dependencies (all packages)
bun install

# Set up environment variables for web dashboard
cp apps/web/.env.example apps/web/.env
# Edit apps/web/.env with your credentials

# Generate Prisma client
cd apps/web && bun run db:generate

# Build all packages
cd ../.. && bun run build
```

## Project Structure

This is a **Turborepo monorepo** with multiple packages:

```
ai-code-auditor/
├── apps/
│   ├── cli/              # Bun-based CLI tool
│   ├── web/              # Next.js dashboard
│   └── action/           # GitHub Action (Node.js)
├── packages/
│   ├── core/             # Multi-agent orchestration engine
│   ├── types/            # Shared TypeScript types
│   ├── api-client/       # Dashboard API client
│   └── config/           # Shared TypeScript config
├── docs/                 # Documentation
└── .claude/
    ├── plans/            # Project planning documents
    └── rules/            # AI assistant rules
```

### Package Dependencies

```
┌─────────┐
│   CLI   │──┐
└─────────┘  │
             ├──> core ──> types
┌─────────┐  │
│   Web   │──┤
└─────────┘  │
             └──> api-client ──> types
┌─────────┐
│ Action  │──> core ──> types
└─────────┘
```

**Important**: `packages/core` has platform-specific discovery implementations:
- `discovery.ts` - Bun-specific (uses `import { Glob } from "bun"`)
- `discovery-node.ts` - Node.js-compatible (uses `glob` package)

The CLI uses Bun's native APIs, while the GitHub Action must use Node.js compatible code.

## Common Development Tasks

### Building

```bash
# Build all packages (respects dependency order)
bun run build

# Build specific package
cd apps/cli && bun run build
cd apps/web && bun run build
cd packages/core && bun run build

# Watch mode for package development
cd packages/core && bun run dev
```

### Running

```bash
# Run CLI in development
cd apps/cli
bun run dev <path-to-audit>

# Run web dashboard
cd apps/web
bun run dev

# Access at http://localhost:3000
```

### Testing

```bash
# Run all tests
bun run test

# CLI tests only
cd apps/cli && bun test

# Web dashboard tests
cd apps/web
bun test                    # Vitest unit tests
bun run test:e2e           # Playwright e2e tests
bun run test:coverage      # Coverage report
bun run test:e2e:ui        # Playwright UI mode
```

### Linting

```bash
# Lint all packages
bun run lint

# Lint specific package
cd apps/web && bun run lint
```

### Database (Web Dashboard)

```bash
cd apps/web

# Generate Prisma client after schema changes
bun run db:generate

# Push schema to database (development)
bun run db:push

# Open Prisma Studio
bun run db:studio
```

### Cleaning

```bash
# Clean all build artifacts
bun run clean

# Clean specific package
cd apps/cli && rm -rf dist
```

## Workflow

### Daily Development

```bash
# Terminal 1: Core package (if working on agents)
cd packages/core
bun run dev                     # Watch mode

# Terminal 2: CLI (if working on CLI)
cd apps/cli
bun run dev src/

# Terminal 3: Web (if working on dashboard)
cd apps/web
bun run dev
```

### Before Committing

```bash
bun run build                   # Verify all packages build
bun run test                    # Run all tests
```

### Adding a New Agent

1. Create `packages/core/src/agents/<name>.ts` implementing `AgentDefinition`
2. Export from `packages/core/src/agents/index.ts`
3. Adjust weights in all agents (must sum to 1.0)
4. Update documentation with new agent description
5. Run tests to verify weight validation

### Adding a New API Endpoint

1. Create `apps/web/app/api/<path>/route.ts`
2. Implement `POST`, `GET`, etc. as named exports
3. Add rate limiting if public endpoint
4. Validate request body with Zod
5. Add corresponding test in `apps/web/test/api/`

### Updating Database Schema

1. Edit `apps/web/prisma/schema.prisma`
2. Run `bun run db:push` (development) or create migration (production)
3. Run `bun run db:generate` to update Prisma client
4. Rebuild packages that import Prisma types

## Build System Details

**Turborepo** orchestrates builds with caching:

- **Build order**: `types` → `core`, `api-client` → `cli`, `web`, `action`
- **Cache**: Turbo caches build outputs for faster rebuilds
- **Parallel**: Independent packages build in parallel

### TypeScript Compilation

After refactoring, if you see TypeScript errors:

1. Rebuild all packages: `bun run build` (from root)
2. Turbo respects dependency order, so types/core rebuild before apps
3. If web build fails with Prisma errors: `cd apps/web && bun run db:generate`

## Environment Variables

### CLI (`apps/cli`)

```bash
ANTHROPIC_API_KEY=sk-ant-...        # Required for analysis
CODE_AUDITOR_API_KEY=...            # Optional for dashboard sync
CODE_AUDITOR_API_URL=...            # Optional (default: production URL)
```

### Web Dashboard (`apps/web`)

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

## Troubleshooting

### Build Failures

**Error**: `Cannot find module '@code-auditor/core'`
- **Fix**: Build dependencies first: `cd packages/core && bun run build`

**Error**: `Module '@prisma/client' has no exported member 'X'`
- **Fix**: Regenerate Prisma client: `cd apps/web && bun run db:generate`

### Test Failures

**Error**: Vitest mocking errors with `db`
- **Fix**: Use async factory functions in `vi.mock()` (see existing tests)

**Error**: Playwright tests can't find database
- **Fix**: Set `DATABASE_URL` in `.env.test` or use test database

### Runtime Errors

**Error**: `ANTHROPIC_API_KEY not configured`
- **Fix**: `export ANTHROPIC_API_KEY='your-key'` or add to shell profile

**Error**: `Dynamic server usage: Route couldn't be rendered statically`
- **Note**: This is expected for API routes that use `headers()` - not an error

## Code Style

- **TypeScript**: Strict mode enabled
- **Server Components**: Default for Next.js (use `"use client"` when needed)
- **Imports**: Prefer absolute imports with `@/` alias in web app
- **Formatting**: Enforced by editor config and lint rules

## Performance

- **Turbo cache**: `>>> FULL TURBO` means 100% cache hit
- **Parallel agent execution**: Uses `Promise.allSettled` for resilience
- **Build time**: ~20s full build, <1s with cache

## Getting Help

- Check [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
- Check [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment issues
- See existing patterns in codebase before creating new ones
- Read CLAUDE.md for AI assistant context
