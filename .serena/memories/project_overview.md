# Varp Project Overview

MCP server + skills + hooks plugin for Claude Code. Adds manifest-aware context management to agent orchestration.

## Tech Stack
- **Runtime**: Bun (install, test, run, build)
- **Language**: TypeScript (ES2022, ESM only, bundler moduleResolution)
- **MCP SDK**: @modelcontextprotocol/sdk
- **Validation**: Zod (schema-first types via z.infer<>)
- **XML**: fast-xml-parser (plan.xml parsing)
- **YAML**: Bun.YAML (built-in)
- **Lint**: oxlint (TypeScript plugin)
- **Format**: oxfmt (100-char width, double quotes, trailing commas)

## Architecture
8 components defined in `varp.yaml`:
- `shared` (src/shared/) — Zod schemas, ownership utils
- `server` (src/) — MCP server wiring, tool definitions (index.ts, tool-registry.ts)
- `manifest` (src/manifest/) — Parser, resolver, freshness, graph, imports, links, lint, scoped-tests, env-check, touches, discovery
- `plan` (src/plan/) — XML parser, validator, diff
- `scheduler` (src/scheduler/) — Hazards, waves, critical path
- `enforcement` (src/enforcement/) — Capabilities, restart strategy
- `skills` (skills/) — 5 prompt-based SKILL.md files
- `hooks` (hooks/) — 4 lifecycle shell scripts

Import alias `#shared/*` → `src/shared/` (tsconfig paths).
