# Varp

Graph-aware project analysis and manifest-driven agent orchestration. Provides structural awareness (coupling diagnostics, scope enforcement, contract verification) as a companion to workflow plugins like superpowers. See ADR-003.

## Quick Reference

| Command                                              | Purpose                                         |
| ---------------------------------------------------- | ----------------------------------------------- |
| `turbo build`                                        | Build all packages                              |
| `turbo test`                                         | Run all tests                                   |
| `turbo check`                                        | Format + lint + build (all packages)            |
| `turbo typecheck`                                    | Type-check all packages via oxlint --type-check |
| `bun test packages/varp/src/mcp/index.test.ts`       | MCP integration tests only                      |
| `bun test packages/varp/src/scheduler/`              | Scheduler tests only                            |
| `bun run packages/varp/dist/cli.js summary`          | Project health digest (coupling, freshness)     |
| `bun run packages/varp/dist/cli.js lint`             | Lint manifest for issues                        |
| `bun run packages/varp/dist/cli.js graph`            | Render dependency graph (ASCII, default)        |
| `bun run packages/varp/dist/cli.js freshness`        | Check doc freshness                             |
| `bun run packages/varp/dist/cli.js validate plan.xml`| Validate plan against manifest                  |
| `bun run packages/varp/dist/cli.js conventions`      | Show component detection conventions            |

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
  varp/                     @vevx/varp — consolidated varp package
    src/
      shared/               Shared types + utilities (types.ts, ownership.ts)
      manifest/             Manifest parsing, doc resolution, freshness, graph, imports, touches, lint
      plan/                 Plan XML parsing, validation, diff
      scheduler/            Hazard detection, wave computation, critical path
      enforcement/          Capability verification, restart strategy
      analysis/             Co-change analysis, coupling matrix, hotspots
      execution/            Chunking, concurrency, token estimation
      mcp/                  MCP server + tool registry
      cli/                  CLI subcommands (init, graph, lint, freshness, validate, coupling, summary)
      lib.ts                Library entry point for external consumers (@vevx/varp/lib)
    lib.d.ts                Hand-maintained declarations for @vevx/varp/lib
    skills/                 6 prompt-based skills (init, status, plan, execute, review, coupling)
    hooks/                  4 lifecycle hooks (session-start, subagent-context, freshness-track, stop)
    .claude-plugin/         Plugin manifest (plugin.json, marketplace.json)
  audit/                    Compliance audit engine + CLI (@vevx/audit, varp-audit binary)
    src/                    Orchestrator, agents, planner, report
    rulesets/               Audit rulesets (OWASP, etc.)
  kiste/                    Git-backed artifact index (@vevx/kiste, Effect TS)
    src/                    Indexer, MCP server, CLI
docs/                       Design docs, getting started, reference URLs
```

Import alias `#shared/*` maps to `packages/varp/src/shared/*`. One library entry point for external consumers with a hand-maintained `.d.ts` file:

- **`@vevx/varp/lib`** — All types and functions (pure + Bun-dependent). Used by `@vevx/audit`. Has a hand-maintained `lib.d.ts` — update it when exported signatures change.

**Details**: See `packages/varp/docs/architecture.md` for algorithms and data flow. See `packages/varp/README.md` for tool API surface. See `packages/varp/src/manifest/README.md` and `packages/varp/src/plan/README.md` for format references. See `docs/reference-urls.md` for canonical doc URLs.

## Key Conventions

- **Types**: Define Zod schema first, infer TypeScript type via `z.infer<>`. Never define types separately.
- **MCP tools**: Accept `manifest_path` parameter (default `./varp.yaml`), parse internally, return JSON as text content.
- **Skills**: Prompt-based SKILL.md files. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Hooks**: No runtime dependencies (no jq/python). Parse with grep/sed/awk. Exit 0 when not applicable. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Tests**: Co-located with source (`*.test.ts`). Run concurrently (`--concurrent`). Use `bun-testing` skill for patterns. Integration tests use `InMemoryTransport` + `Client`.
- **Subprocesses**: Use `Bun.spawn`/`Bun.spawnSync` instead of `child_process`. Never use `require("child_process")`.
- **Lint/Format**: Run `turbo check` before committing (runs format + lint + build in all packages). oxfmt handles formatting — don't manually adjust style. Shellcheck enforces shell script quality (varp package). oxlint runs with `--type-aware` in all packages; varp also uses `--type-check` to replace `tsc --noEmit`.
- **Volatile specs**: Skills, hooks, MCP, plugin.json, and Bun APIs change frequently. Search the web for current docs before modifying (see `.claude/rules/volatile-specs.md`).
