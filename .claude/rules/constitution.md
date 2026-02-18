# Project Constitution

Injected to all subagents via SubagentStart hook.

## Conventions

- **Bun** for package management and CLI runtime
- **Server Components** by default — `"use client"` only when needed
- **Env vars** validated via `lib/env.ts` (t3-env)
- **API keys** bcrypt hashed, never plain text
- **Rate limit** all public endpoints
- **Webhook signatures** verified (Clerk via Svix, Stripe via SDK)
- **Agent weights must sum to 1.0**
- **Dual discovery**: `discovery.ts` (Bun) and `discovery-node.ts` (Node.js) — update BOTH when modifying

## After Every Task

1. Verify: tests, lint, build pass
2. Document: update docs if behavior/architecture changed
3. Commit: conventional format
