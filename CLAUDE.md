# Varp

MCP server + skills + hooks plugin for Claude Code. Adds manifest-aware context management to agent orchestration.

## Quick Reference

| Command | Purpose |
|---------|---------|
| `bun test` | Run all tests (174 tests, 20 files) |
| `bun run check` | Format check + lint + shellcheck + build (CI gate) |
| `bun run build` | Bundle to `build/` via bun build |
| `bun run typecheck` | Type-check via tsc --noEmit (not in CI gate) |
| `bun run lint` | Run oxlint |
| `bun run format` | Auto-format with oxfmt |
| `bun test src/index.test.ts` | MCP integration tests only |
| `bun test src/scheduler/` | Scheduler tests only |

## Stack

- **Runtime**: Bun (install, test, run)
- **Language**: TypeScript (ES2022, bundler moduleResolution)
- **MCP SDK**: `@modelcontextprotocol/sdk` (see `docs/reference-urls.md` for current SDK docs)
- **Validation**: Zod (schemas are single source of truth for types)
- **XML**: fast-xml-parser (plan.xml parsing)
- **YAML**: Bun.YAML (built-in Zig-native YAML 1.2 parser)
- **Lint**: oxlint (TypeScript plugin, correctness rules)
- **Format**: oxfmt (100-char width, double quotes, trailing commas)

## Architecture

`varp.yaml` is the source of truth for project structure. It defines components, their file paths, dependency graph, and doc locations.

```
src/                    MCP server (17 tools)
  types.ts              Zod schemas -> TypeScript types
  manifest/             Manifest parsing, doc resolution, freshness, graph, imports, touches, lint, scoped-tests
  scheduler/            Hazard detection, wave computation, critical path
  plan/                 Plan XML parsing, validation, diff
  enforcement/          Capability verification, restart strategy
skills/                 4 prompt-based skills (status, plan, execute, review)
hooks/                  3 lifecycle hooks (session-start, subagent-context, freshness-track)
src/docs/               Architecture internals (private core doc)
docs/                   Design docs, getting started, reference URLs
```

**Details**: See `src/docs/architecture.md` for algorithms and data flow. See `src/README.md` for tool API surface. See `src/manifest/README.md` and `src/plan/README.md` for format references. See `docs/reference-urls.md` for canonical doc URLs.

## Key Conventions

- **Types**: Define Zod schema first, infer TypeScript type via `z.infer<>`. Never define types separately.
- **MCP tools**: Accept `manifest_path` parameter (default `./varp.yaml`), parse internally, return JSON as text content.
- **Skills**: Prompt-based SKILL.md files. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Hooks**: No runtime dependencies (no jq/python). Parse with grep/sed/awk. Exit 0 when not applicable. Spec changes frequently — check `docs/reference-urls.md` before modifying.
- **Tests**: Co-located with source (`*.test.ts`). Integration tests use `InMemoryTransport` + `Client`.
- **Lint/Format**: Run `bun run check` before committing. oxfmt handles formatting — don't manually adjust style. Shellcheck enforces shell script quality.
- **Volatile specs**: Skills, hooks, MCP, plugin.json, and Bun APIs change frequently. Search the web for current docs before modifying (see `.claude/rules/volatile-specs.md`).
