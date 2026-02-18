# Varp

Monorepo for manifest-aware agent orchestration: MCP server (core), compliance audit engine, skills, and hooks.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `turbo build` | Build all packages |
| `turbo test` | Run all tests |
| `turbo check` | Format + lint + build (all packages) |
| `turbo typecheck` | Type-check all packages via oxlint --type-check |
| `bun test packages/core/src/index.test.ts` | MCP integration tests only |
| `bun test packages/core/src/scheduler/` | Scheduler tests only |
| `bun run packages/cli/dist/cli.js lint` | Lint manifest for issues |
| `bun run packages/cli/dist/cli.js graph` | Render dependency graph (Mermaid) |
| `bun run packages/cli/dist/cli.js freshness` | Check doc freshness |
| `bun run packages/cli/dist/cli.js validate plan.xml` | Validate plan against manifest |

## Stack

- **Runtime**: Bun (install, test, run)
- **Build**: Turborepo (task orchestration across packages)
- **Language**: TypeScript (ES2022, ESM only, bundler moduleResolution). Never use `require()` or CJS patterns.
- **MCP SDK**: `@modelcontextprotocol/sdk` (see `docs/reference-urls.md` for current SDK docs)
- **Validation**: Zod (schemas are single source of truth for types)
- **XML**: fast-xml-parser (plan.xml parsing)
- **YAML**: Bun.YAML (built-in Zig-native YAML 1.2 parser)
- **Lint**: oxlint with type-aware rules via tsgolint (TypeScript plugin, correctness + type-checked rules)
- **Format**: oxfmt (100-char width, double quotes, trailing commas)

## Architecture

`varp.yaml` is the source of truth for project structure. Monorepo layout:

```
packages/
  core/                   Varp MCP server (@varp/core)
    src/                  shared, server, manifest, plan, scheduler, enforcement
      shared/             Shared types + utilities (types.ts, ownership.ts)
      lib.ts              Library entry point for external consumers (@varp/core/lib)
    lib.d.ts              Hand-maintained declarations for @varp/core/lib
      manifest/           Manifest parsing, doc resolution, freshness, graph, imports, touches, lint, scoped-tests
      plan/               Plan XML parsing, validation, diff
      scheduler/          Hazard detection, wave computation, critical path
      enforcement/        Capability verification, restart strategy
  audit/                  Compliance audit engine (@varp/audit)
    src/                  Orchestrator, agents, planner, report
    rulesets/             Audit rulesets (OWASP, etc.)
  cli/                    Varp CLI (@varp/cli) — subcommands: audit, lint, graph, freshness, validate
  plugin/                 Claude Code plugin distribution (@varp/plugin)
    .claude-plugin/       Plugin manifest (plugin.json, marketplace.json)
    skills/               5 prompt-based skills (init, status, plan, execute, review)
    hooks/                3 lifecycle hooks (session-start, subagent-context, freshness-track)
docs/                     Design docs, getting started, reference URLs
```

Import alias `#shared/*` maps to `packages/core/src/shared/*`. One library entry point for external consumers with a hand-maintained `.d.ts` file:

- **`@varp/core/lib`** — All types and functions (pure + Bun-dependent). Used by `@varp/audit` and `@varp/cli`. Has a hand-maintained `lib.d.ts` — update it when exported signatures change.

**Details**: See `packages/core/docs/architecture.md` for algorithms and data flow. See `packages/core/README.md` for tool API surface. See `packages/core/src/manifest/README.md` and `packages/core/src/plan/README.md` for format references. See `docs/reference-urls.md` for canonical doc URLs.

## Key Conventions

- **Types**: Define Zod schema first, infer TypeScript type via `z.infer<>`. Never define types separately.
- **MCP tools**: Accept `manifest_path` parameter (default `./varp.yaml`), parse internally, return JSON as text content.
- **Skills**: Prompt-based SKILL.md files. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Hooks**: No runtime dependencies (no jq/python). Parse with grep/sed/awk. Exit 0 when not applicable. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Tests**: Co-located with source (`*.test.ts`). Run concurrently (`--concurrent`). Use `bun-testing` skill for patterns. Integration tests use `InMemoryTransport` + `Client`.
- **Subprocesses**: Use `Bun.spawn`/`Bun.spawnSync` instead of `child_process`. Never use `require("child_process")`.
- **Lint/Format**: Run `turbo check` before committing (runs format + lint + build in all packages). oxfmt handles formatting — don't manually adjust style. Shellcheck enforces shell script quality (core only). oxlint runs with `--type-aware` in all packages; core also uses `--type-check` to replace `tsc --noEmit`.
- **Volatile specs**: Skills, hooks, MCP, plugin.json, and Bun APIs change frequently. Search the web for current docs before modifying (see `.claude/rules/volatile-specs.md`).
