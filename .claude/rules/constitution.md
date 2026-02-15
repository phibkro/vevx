# AI Code Auditor - Project Constitution

**Scope**: Project-specific rules for orchestrator AND all subagents (this project only)
**Injected to subagents**: Yes (via SubagentStart hook)

## Development Model

**Agent Driven Development (ADD)** - AI agents orchestrated by Claude build this codebase.
- See `docs/agent-driven-development/` for orchestration plans
- Agents work by scope (apps/web, apps/cli, packages/core), not by role
- Resume agents with role injection (Builder → Tester → Reviewer)

## Tech Stack

- **Package manager**: Bun (`bun install`, `bun test`, `bun run`)
- **Monorepo**: Turborepo (3 apps, 3 packages)
- **CLI**: Bun runtime (native APIs)
- **Web**: Next.js 14 App Router, React 18, TypeScript strict
- **Database**: Prisma ORM + PostgreSQL (Neon)
- **Auth**: Clerk (GitHub OAuth + email)
- **Payments**: Stripe (Free/Pro $39/Team $249)
- **Rate limiting**: Upstash Redis
- **Testing**: Vitest (unit), Playwright (e2e)

## Project Structure

```
apps/
├── cli/              # Bun-based CLI tool
├── web/              # Next.js dashboard
└── action/           # GitHub Action (Node.js)

packages/
├── core/             # Multi-agent orchestration engine
├── types/            # Shared TypeScript types
└── config/           # Shared TS config
```

## File Locations

### CLI (apps/cli)
- Entry: `apps/cli/src/cli.ts`
- Discovery: `packages/core/src/discovery.ts` (Bun-specific)

### Web (apps/web)
- API routes: `apps/web/app/api/`
- Server utilities: `apps/web/lib/`
- Database schema: `apps/web/prisma/schema.prisma`
- Components: `apps/web/components/` (shadcn/ui)
- Tests: `apps/web/test/`, `apps/web/e2e/`
- Environment: `apps/web/.env` (use t3-env for validation)

### Core (packages/core)
- Orchestrator: `packages/core/src/orchestrator.ts`
- Agents: `packages/core/src/agents/*.ts`
- Discovery (Node.js): `packages/core/src/discovery-node.ts` (for GitHub Action)

## Platform-Specific Code (CRITICAL)

**Two discovery implementations**:
- `discovery.ts` - Bun-specific (CLI uses)
- `discovery-node.ts` - Node.js compatible (Action uses)

**Why**: GitHub Actions run in Node.js, can't use Bun APIs.
**Important**: When modifying discovery, update BOTH files.

## Testing

```bash
# All tests
bun test

# Web tests
cd apps/web && bun test              # Unit tests
cd apps/web && bun run test:e2e      # E2E tests
cd apps/web && bun run test:coverage # Coverage

# CLI tests
cd apps/cli && bun test
```

**All tests must pass before committing.**

## Conventions

- **Server Components by default** - Add `"use client"` only when needed
- **API routes** for external requests, **Server Actions** for internal
- **Validate all env vars** via `lib/env.ts` (t3-env)
- **Hash API keys** with bcrypt (never plain text)
- **Rate limit** all public endpoints
- **Verify webhook signatures** (Clerk via Svix, Stripe via SDK)
- **Agent weights must sum to 1.0** (validated on module load)

## Agent Workflow (Mandatory)

After completing ANY task, agents MUST:
1. ✅ **Verify** via CI/CD (tests, coverage, lint, build)
2. ✅ **Document** changes (ALWAYS check if docs need updates)
3. ✅ **Report** status (commit with conventional format, note context usage)
4. ✅ **Manage context** (summarize if >80%, store patterns in MEMORY.md)

## Documentation

**For agents**: `docs/AGENT-GUIDE.md` - Single comprehensive reference
**For orchestration**: `docs/agent-driven-development/` - Plans, practices, prioritization
**For product design**: `docs/ARCHITECTURE.md` - Multi-agent system architecture
