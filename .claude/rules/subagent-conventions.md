## Varp Project Conventions

This is a Varp-managed project (varp.yaml defines components, paths, dependencies, doc locations).

**Stack**: Bun (runtime/test/install), TypeScript (ES2022, ESM only), Zod (schema-first types), MCP SDK.

**Key rules**:
- Modules: ESM only. Use `import`/`export`, never `require()` or `module.exports`. Use `.js` extensions in import specifiers.
- Types: Define Zod schema first, infer via `z.infer<>`. Never define standalone interfaces.
- Tests: Co-located `*.test.ts` files. Run concurrently (`--concurrent`). Use `test.serial` for shared mutable state. JUnit XML reports via `--reporter=junit`.
- Subprocesses: Use `Bun.spawn`/`Bun.spawnSync`, never `child_process`.
- Build: `turbo build` (all packages) or `bun run build` in `packages/core/`.
- Lint/Format: `turbo check` (runs format + lint + build in all packages). oxfmt handles formatting — don't manually adjust style. oxlint runs with `--type-aware` (type-checked rules via tsgolint).
- MCP tools: Accept `manifest_path` param, parse internally, return JSON as text content.
- Hooks: No runtime deps (no jq/python). grep/sed/awk + bash parameter expansion. Exit 0 when `varp.yaml` missing. Must pass shellcheck.
- Skills/hooks/MCP specs change frequently — check `docs/reference-urls.md` for current docs before modifying.

**Core components**: `shared` = `packages/core/src/shared/`, `server` = `packages/core/src/`, `manifest` = `packages/core/src/manifest/`, `plan` = `packages/core/src/plan/`, `scheduler` = `packages/core/src/scheduler/`, `enforcement` = `packages/core/src/enforcement/`, `skills` = `packages/plugin/skills/`, `hooks` = `packages/plugin/hooks/`. Domain components import shared types via `#shared/*` alias. Skills/hooks depend on manifest.

**Audit** (experimental): `audit` = `packages/audit/src/`. Single component — planner and agents are internal subdirectories.

**CLI** (experimental): `cli` = `packages/cli/src/`. Wraps core and audit with I/O, file discovery, and Anthropic SDK.

If you modify component files, note which components were affected in your response.
