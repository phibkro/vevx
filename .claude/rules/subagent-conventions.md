## Varp Project Conventions

This is a Varp-managed project (varp.yaml defines components, paths, dependencies, doc locations).

**Stack**: Bun (runtime/test/install), TypeScript (ES2022, ESM only), Zod (schema-first types), MCP SDK.

**Key rules**:
- Modules: ESM only. Use `import`/`export`, never `require()` or `module.exports`. Use `.js` extensions in import specifiers.
- Types: Define Zod schema first, infer via `z.infer<>`. Never define standalone interfaces.
- Tests: Co-located `*.test.ts` files. Run with `bun test`.
- Build: `turbo build` (all packages) or `bun run build` in `packages/core/`.
- Lint/Format: `bun run check` in `packages/core/` (oxfmt + oxlint + shellcheck + build). oxfmt handles formatting — don't manually adjust style.
- MCP tools: Accept `manifest_path` param, parse internally, return JSON as text content.
- Hooks: No runtime deps (no jq/python). grep/sed/awk + bash parameter expansion. Exit 0 when `varp.yaml` missing. Must pass shellcheck.
- Skills/hooks/MCP specs change frequently — check `docs/reference-urls.md` for current docs before modifying.

**Core components** (8): `shared` = `packages/core/src/shared/`, `server` = `packages/core/src/`, `manifest` = `packages/core/src/manifest/`, `plan` = `packages/core/src/plan/`, `scheduler` = `packages/core/src/scheduler/`, `enforcement` = `packages/core/src/enforcement/`, `skills` = `packages/plugin/skills/`, `hooks` = `packages/plugin/hooks/`. Domain components import shared types via `#shared/*` alias. Skills/hooks depend on manifest.

**Audit** (1, experimental): `audit` = `packages/audit/src/`. Single component — planner and agents are internal subdirectories.

**CLI** (experimental): `cli` = `apps/cli/src/`. Unified CLI for all varp tools.

If you modify component files, note which components were affected in your response.
