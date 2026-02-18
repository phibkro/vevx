# Varp Project Overview

Monorepo for manifest-aware agent orchestration: MCP server (core), compliance audit engine, skills, and hooks.

## Tech Stack
- **Runtime**: Bun (install, test, run, build)
- **Build**: Turborepo (task orchestration across packages)
- **Language**: TypeScript (ES2022, ESM only, bundler moduleResolution)
- **MCP SDK**: @modelcontextprotocol/sdk
- **Validation**: Zod (schema-first types via z.infer<>)
- **XML**: fast-xml-parser (plan.xml parsing)
- **YAML**: Bun.YAML (built-in)
- **Lint**: oxlint (TypeScript plugin)
- **Format**: oxfmt (100-char width, double quotes, trailing commas)

## Architecture
Monorepo with Bun workspaces (`packages/*`, `apps/*`):

### @varp/core (packages/core/)
8 components defined in `varp.yaml`:
- `shared` (packages/core/src/shared/) — Zod schemas, ownership utils
- `server` (packages/core/src/) — MCP server wiring, tool definitions
- `manifest` (packages/core/src/manifest/) — Parser, resolver, freshness, graph, imports, links, lint, scoped-tests, env-check, touches, discovery
- `plan` (packages/core/src/plan/) — XML parser, validator, diff
- `scheduler` (packages/core/src/scheduler/) — Hazards, waves, critical path
- `enforcement` (packages/core/src/enforcement/) — Capabilities, restart strategy
- `skills` (skills/) — 5 prompt-based SKILL.md files
- `hooks` (hooks/) — 3 lifecycle shell scripts

### @varp/audit (packages/audit/)
Compliance audit engine (experimental):
- `audit-core` (packages/audit/src/) — Orchestrator, chunker, client
- `audit-planner` (packages/audit/src/planner/) — Planner, ruleset parser
- `audit-agents` (packages/audit/src/agents/) — Domain-specific audit agents

### @varp/audit-cli (apps/audit-cli/)
CLI for running audits. Depends on @varp/audit (workspace).

Import alias `#shared/*` → `packages/core/src/shared/` (tsconfig paths in packages/core/).
`tsconfig.base.json` at root, packages extend it.
