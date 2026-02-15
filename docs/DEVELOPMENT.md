# Development Reference

Quick reference for AI agents working on this codebase.

## Essential Commands

```bash
# Build
bun run build                   # All packages (respects dependency order)
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
ANTHROPIC_API_KEY=sk-ant-...        # Required
CODE_AUDITOR_API_KEY=...            # Optional (dashboard sync)
CODE_AUDITOR_API_URL=...            # Optional
```

### Web (apps/web)
See `apps/web/.env.example` - key vars:
```bash
DATABASE_URL=postgresql://...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
STRIPE_SECRET_KEY=sk_...
UPSTASH_REDIS_REST_URL=https://...
```

## Troubleshooting

### Build errors
```bash
# Missing module '@code-auditor/core'
cd packages/core && bun run build

# Prisma client errors
cd apps/web && bun run db:generate

# Clean rebuild
bun run clean && bun run build
```

### Test errors
- Vitest mocking: Use async factory functions (see existing tests)
- TypeScript errors: `bun run build` to rebuild all packages in order

## Platform-Specific Code

**Critical**: `packages/core` has two discovery implementations:
- `discovery.ts` - Bun-specific (CLI uses this)
- `discovery-node.ts` - Node.js compatible (GitHub Action uses this)

**Why**: GitHub Actions run in Node.js, can't use Bun APIs.
