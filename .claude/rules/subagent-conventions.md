## Varp Project Conventions

This is a Varp-managed project (varp.yaml defines components, paths, dependencies, doc locations).

**Stack**: Bun (runtime/test/install), TypeScript (ES2022), Zod (schema-first types), MCP SDK.

**Key rules**:
- Types: Define Zod schema first, infer via `z.infer<>`. Never define standalone interfaces.
- Tests: Co-located `*.test.ts` files. Run with `bun test`.
- Build: `bun run build` (tsc to `build/`).
- MCP tools: Accept `manifest_path` param, parse internally, return JSON as text content.
- Hooks: No runtime deps (no jq/python). grep/sed/awk only. Exit 0 when `varp.yaml` missing.
- Skills/hooks/MCP specs change frequently — check `src/docs/reference-urls.md` for current docs before modifying.

**Module structure**: `src/manifest/` (parser, resolver, freshness, graph), `src/scheduler/` (hazards, waves, critical-path), `src/plan/` (parser, validator), `src/enforcement/` (capabilities, restart).

If you modify component files, note which components were affected in your response.
