# Quick Start for AI Agents

Fast onboarding guide for AI assistants working on this project.

## What This Is

AI Code Auditor is a **multi-agent code quality tool**. Five specialized AI agents analyze code in parallel across different quality dimensions (correctness, security, performance, maintainability, edge cases), then synthesize results into a comprehensive report.

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

# Test
bun test                        # All tests
cd apps/web && bun test         # Web unit tests
cd apps/web && bun run test:e2e # Web e2e tests

# Development
cd apps/cli && bun run dev <path>   # Run CLI
cd apps/web && bun run dev          # Run dashboard
cd packages/core && bun run dev     # Watch mode for core
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

### Platform Compatibility

**Two discovery implementations**:
- `discovery.ts` - Bun-specific (CLI uses)
- `discovery-node.ts` - Node.js compatible (GitHub Action uses)

This is because GitHub Actions run in Node.js, not Bun.

## Making Changes

### Adding a New Agent

1. Create `packages/core/src/agents/my-agent.ts`
2. Export from `packages/core/src/agents/index.ts`
3. **Adjust all agent weights** to sum to 1.0
4. Add tests
5. Update README.md

See `packages/core/docs/ADDING-AGENTS.md` for details.

### Adding API Endpoint

1. Create `apps/web/app/api/<path>/route.ts`
2. Add rate limiting (if public)
3. Validate input with Zod
4. Add tests in `apps/web/test/api/`

### Updating Database Schema

1. Edit `apps/web/prisma/schema.prisma`
2. Run `cd apps/web && bun run db:generate`
3. Rebuild packages that import Prisma types

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

## Debugging

**CLI issues**:
```bash
cd apps/cli
bun run dev <path> --model claude-opus-4-6
```

**Build failures**:
```bash
# Clean and rebuild
bun run clean && bun run build

# Rebuild Prisma client if needed
cd apps/web && bun run db:generate
```

**Test failures with mocking**:
- Use async factory functions in `vi.mock()`
- See existing tests for patterns

## Important Constraints

1. **Agent weights must sum to 1.0**
2. **CLI uses Bun APIs** (discovery.ts excluded from Action build)
3. **Web uses Server Components** by default
4. **All public APIs need rate limiting**
5. **API keys are bcrypt hashed** (never plain)

## Getting Help

1. **Read CLAUDE.md first** - Most comprehensive guidance
2. **Check docs/** - Architecture, development, deployment
3. **Read existing code** - Patterns are established
4. **Ask questions** - Better than guessing

## Next Steps

After reading this:
1. Read `CLAUDE.md` for complete context
2. Read `docs/ARCHITECTURE.md` for technical deep dive
3. Read `docs/DEVELOPMENT.md` for development workflows
4. Pick a task and start coding!
