# AI Code Auditor - Project Constitution

Auto-injected into all subagents via SubagentStart hook.

## Tech Stack

- **Package manager**: Bun (`bun install`, `bun test`, `bun run`)
- **Web**: Next.js 14 App Router, React 18, TypeScript strict
- **Database**: Prisma ORM + PostgreSQL (Neon)
- **Auth**: Clerk (GitHub OAuth + email)
- **Payments**: Stripe (Free/Pro $39/Team $249)
- **Rate limiting**: Upstash Redis
- **Testing**: Vitest (unit), Playwright (e2e)

## Project Structure

Monorepo (planned):
- `web/`: Next.js dashboard (exists)
- `cli/`: Bun CLI tool (planned)

Current: web/ only

## File Locations

- API routes: `web/app/api/`
- Server utilities: `web/lib/`
- Database schema: `web/prisma/schema.prisma`
- Components: `web/components/` (shadcn/ui)
- Tests: `web/test/`, `web/e2e/`
- Environment: `web/.env` (use t3-env for validation)

## Testing

- Unit: `cd web && bun test`
- E2E: `cd web && bun run test:e2e`
- Coverage: `cd web && bun run test:coverage`
- All tests must pass before committing

## Conventions

- Server Components by default
- API routes for external requests, Server Actions for internal
- Validate all env vars via `lib/env.ts` (t3-env)
- Hash API keys with bcrypt
- Rate limit all public endpoints
- Verify webhook signatures (Clerk via Svix, Stripe)
