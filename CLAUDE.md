# Varp

Monorepo for manifest-aware agent orchestration: MCP server (core), compliance audit engine, skills, and hooks.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `turbo build` | Build all packages |
| `turbo test` | Run all tests |
| `cd packages/core && bun run check` | Format + lint + shellcheck + build (core CI gate) |
| `cd packages/core && bun run typecheck` | Type-check core via tsc --noEmit |
| `bun test packages/core/src/index.test.ts` | MCP integration tests only |
| `bun test packages/core/src/scheduler/` | Scheduler tests only |

## Stack

- **Runtime**: Bun (install, test, run)
- **Build**: Turborepo (task orchestration across packages)
- **Language**: TypeScript (ES2022, ESM only, bundler moduleResolution). Never use `require()` or CJS patterns.
- **MCP SDK**: `@modelcontextprotocol/sdk` (see `docs/reference-urls.md` for current SDK docs)
- **Validation**: Zod (schemas are single source of truth for types)
- **XML**: fast-xml-parser (plan.xml parsing)
- **YAML**: Bun.YAML (built-in Zig-native YAML 1.2 parser)
- **Lint**: oxlint (TypeScript plugin, correctness rules)
- **Format**: oxfmt (100-char width, double quotes, trailing commas)

## Architecture

`varp.yaml` is the source of truth for project structure. Monorepo layout:

```
packages/
  core/                   Varp MCP server (@varp/core)
    src/                  shared, server, manifest, plan, scheduler, enforcement
      shared/             Shared types + utilities (types.ts, ownership.ts)
      manifest/           Manifest parsing, doc resolution, freshness, graph, imports, touches, lint, scoped-tests
      plan/               Plan XML parsing, validation, diff
      scheduler/          Hazard detection, wave computation, critical path
      enforcement/        Capability verification, restart strategy
  audit/                  Compliance audit engine (@varp/audit)
    src/                  Orchestrator, agents, planner, report
    rulesets/             Audit rulesets (OWASP, etc.)
apps/
  cli/                    Varp CLI (@varp/cli)
  plugin/                  Claude Code plugin distribution (@varp/plugin)
    .claude-plugin/       Plugin manifest (plugin.json, marketplace.json)
    skills/               5 prompt-based skills (init, status, plan, execute, review)
    hooks/                3 lifecycle hooks (session-start, subagent-context, freshness-track)
docs/                     Design docs, getting started, reference URLs
```

Import alias `#shared/*` maps to `packages/core/src/shared/*`.

**Details**: See `packages/core/docs/architecture.md` for algorithms and data flow. See `packages/core/README.md` for tool API surface. See `packages/core/src/manifest/README.md` and `packages/core/src/plan/README.md` for format references. See `docs/reference-urls.md` for canonical doc URLs.

## Key Conventions

- **Types**: Define Zod schema first, infer TypeScript type via `z.infer<>`. Never define types separately.
- **MCP tools**: Accept `manifest_path` parameter (default `./varp.yaml`), parse internally, return JSON as text content.
- **Skills**: Prompt-based SKILL.md files. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Hooks**: No runtime dependencies (no jq/python). Parse with grep/sed/awk. Exit 0 when not applicable. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Tests**: Co-located with source (`*.test.ts`). Integration tests use `InMemoryTransport` + `Client`.
- **Lint/Format**: Run `bun run check` in `packages/core/` before committing. oxfmt handles formatting — don't manually adjust style. Shellcheck enforces shell script quality.
- **Volatile specs**: Skills, hooks, MCP, plugin.json, and Bun APIs change frequently. Search the web for current docs before modifying (see `.claude/rules/volatile-specs.md`).
