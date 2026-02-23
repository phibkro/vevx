# Next Phase Plan

**Date:** 2026-02-22
**Updated:** 2026-02-23
**Status:** Ready for pickup by any agent

## Current State

### What's Built

| Package | Version | Tests | Coverage | Plugin | Status |
|---------|---------|-------|----------|--------|--------|
| @vevx/varp | 0.1.0 | 498 pass | 96% lines | 6 skills, 4 hooks, MCP (23 tools) | Stable |
| @vevx/audit | 0.1.0 | ~60 pass | ~80% lines | None | Experimental |
| @vevx/kiste | 0.1.0 | 49 pass | 91% lines | 3 skills, 2 hooks, MCP (6 tools) | Experimental |
| @vevx/kart | 0.6.0 | 298 pass | ~90% lines | 1 skill, 2 hooks, MCP (24 tools) | Experimental |

### Infrastructure

- **Monorepo**: Bun workspaces + Turborepo. `turbo build`, `turbo test`, `turbo check`.
- **CI**: `.github/workflows/ci.yml` — format + lint + build + test + coverage upload + changeset enforcement on PRs.
- **Changesets**: `@changesets/cli` initialized, `access: public`. Changeset required for PRs touching `packages/**`.
- **MCP servers**: All 3 in `.mcp.json` (varp, kart, kiste). Not in plugin — MCP must be in `.mcp.json` due to plugin cache path resolution issues.
- **Plugins**: Each package has `.claude-plugin/plugin.json`. Varp marketplace (`packages/varp/.claude-plugin/marketplace.json`) lists varp + kiste. Kart has its own marketplace entry.

### Recent Decisions

- **Don't rewrite varp in Effect TS** — Pure/impure boundaries already clean, 96% coverage. Zod→Effect Schema migration is ~50% of effort for ~5% of benefit. Effect is right for kiste/kart (stateful services), plain TS is right for varp (stateless request/response).
- **Plugin cache keys on version** — Bump version in plugin.json for cache to pick up new files.
- **PostToolUse hook pattern for post-commit** — `matcher: "Bash"`, script greps stdin for `git commit`.

## Next Work

### ~~Priority 1: Commit Hygiene~~ ✅ Done

`.gitignore` committed in `46ed05c`. Plan docs clean.

### Priority 2: Audit Plugin

The audit package has no plugin structure. It's the most complex package (orchestrator, agents, planner, report) and the furthest from being usable as a plugin.

**Tasks:**
1. Create `packages/audit/.claude-plugin/plugin.json`
2. Design skills — likely `/audit:run` (run audit against codebase), `/audit:review` (review findings)
3. Consider MCP tools or keep CLI-only (audit is a heavy operation, may not suit MCP request/response)
4. Add to vevx marketplace
5. Audit depends on `@vevx/varp` — ensure the dependency works post-consolidation (`@vevx/varp/lib` import path)

### Priority 3: Cross-Plugin Integration

The three plugins (varp, kiste, kart) work independently but could compose:

- ~~**kiste + varp**: `varp_suggest_touches` uses kiste's co-change data.~~ ✅ Done — `readKisteCoChanges` reads `.kiste/index.sqlite` directly via `bun:sqlite` (no kiste dep). Remaining: kiste tag search enriched with varp component ownership.
- **kart + kiste**: Kart's `kart_cochange` and kiste's provenance overlap. Consider whether kart's co-change DB should be replaced by kiste's, or kept separate (kart is file-level behavioral coupling, kiste is artifact-level semantic).
- **Unified marketplace**: Currently varp's marketplace lists varp+kiste, kart has its own. Should consolidate to one repo-root marketplace listing all plugins.

**Decision needed:** Is further cross-plugin integration worth the coupling, or should they stay independent?

### Priority 4: Publishing Prep

- ~~Rename GitHub repo~~ ✅ Done — now `phibkro/vevx`
- npm publish setup (scope `@vevx`, changesets publish workflow)
- Per-package README polish for npm landing pages

### Priority 5: Kiste Enhancements

- **Write tool**: `kiste_tag` — let agents tag artifacts without going through git commits. Tradeoff: manual tags lack commit provenance.
- **Richer tag derivation**: Current folder-derived tags are noisy (`.turbo`, `cache`, `__tests__`). Default exclusion list or smarter stop-tag config.
- **Context skill testing**: `/kiste:context` was just created but not exercised end-to-end. Try it on a real task to validate the workflow.
- **End-to-end kiste+varp test**: Phase 3 gate — demonstrate that varp sessions are measurably better with kiste indexed (see `packages/kiste/docs/design.md`).

### Priority 6: Kart Enhancements

- **Coverage**: Pure modules at 100%, effectful modules need more integration tests (LSP, SQLite)
- **Co-change enrichment**: Kart's co-change DB uses raw git history. Could benefit from conventional commit parsing (like kiste does) to weight by scope.
- **Directory zoom**: `kart_zoom` works on files. Directory-level zoom (list modules + their export counts) would help agents navigate unfamiliar packages.

## How to Pick Up

1. Run `turbo build && turbo test` to verify everything passes
2. Read `CLAUDE.md` for conventions and architecture overview
3. Read `packages/<pkg>/README.md` for per-package context
4. Pick a priority from above and go
