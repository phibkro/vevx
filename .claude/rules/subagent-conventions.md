## Varp Project Conventions

This is a Varp-managed project (varp.yaml defines components, paths, dependencies, doc locations).

**Stack**: Bun (runtime/test/install), TypeScript (ES2022, ESM only), Zod (schema-first types), MCP SDK.

**Key rules**:
- Modules: ESM only. Use `import`/`export`, never `require()` or `module.exports`. Use `.js` extensions in import specifiers.
- Types: Define Zod schema first, infer via `z.infer<>`. Never define standalone interfaces.
- Tests: Co-located `*.test.ts` files. Run concurrently (`--concurrent`). Use `bun-testing` skill for patterns.
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

## Code Quality Guidelines

### Before Writing Code

Ask silently before each implementation decision:

- Does this pattern already exist in the component? Match it, don't invent a new one.
- Am I adding an abstraction because I need it now, or because I might need it later? If later, write the concrete version.
- Can I point to two other call sites that would use this function/class/type? If not, inline it.
- Would a teammate reading this for the first time understand it without me explaining it? If not, simplify.

### Before Writing Tests

Ask silently before each test:

- What specific bug or regression does this catch? If I can't name one, don't write it.
- Would anyone notice if this test was deleted? If the answer is "no," it's not testing behavior.
- Am I testing my code or the language? Type checks, instanceof assertions, and "returns the right type" tests belong to TypeScript, not to me.
- Does a test helper for this already exist in a fixtures file? Check before writing a new one.

Prefer fewer, meaningful tests over high line counts:

- One test per behavior, not one test per code path.
- Edge cases and error paths over happy paths — happy paths are usually covered by integration tests.
- Test the contract (what it does), not the implementation (how it does it). If refactoring the internals breaks the test, the test was wrong.

### Before Adding Files

Ask silently:

- Does this need to be a separate file, or does it belong in an existing one? New files have coordination costs.
- If this is a utility, does the component already have a utils file? Add to it rather than creating a parallel one.

### Style

- Match the surrounding code's patterns, naming, and structure. Consistency across the component beats local perfection.
- Prefer early returns over nested conditionals.
- Prefer named variables for complex expressions over inline comments explaining them.
- If a function exceeds ~40 lines, look for a natural seam to extract — but only if the extracted piece has a clear name and purpose.
