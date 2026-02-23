# Next Phase Plan

**Date:** 2026-02-22
**Updated:** 2026-02-23
**Status:** Ready for pickup by any agent

## Current State

### What's Built

| Package | Version | Tests | Coverage | Plugin | Status |
|---------|---------|-------|----------|--------|--------|
| @vevx/varp | 0.1.1 | 498 pass | 96% lines | 6 skills, 4 hooks, MCP (23 tools) | Stable |
| @vevx/audit | 0.1.1 | ~60 pass | ~80% lines | None | Experimental, on hold |
| @vevx/kiste | 0.2.0 | 51 pass | 91% lines | 3 skills, 2 hooks, MCP (7 tools) | Experimental |
| @vevx/kart | 0.5.0 | 301 pass | ~90% lines | 1 skill, 2 hooks, MCP (24 tools) | Experimental |

### Infrastructure

- **Monorepo**: Bun workspaces + Turborepo. `turbo build`, `turbo test`, `turbo check`.
- **CI**: `.github/workflows/ci.yml` — format + lint + build + test + coverage upload + changeset enforcement on PRs.
- **Release**: `.github/workflows/release.yml` — changesets/action creates Release PRs and publishes to npm on merge.
- **Changesets**: `@changesets/cli`, `access: public`. Changeset required for PRs touching `packages/**`. Audit is ignored.
- **MCP servers**: All 3 in `.mcp.json` (varp, kart, kiste). Not in plugin — MCP must be in `.mcp.json` due to plugin cache path resolution issues.
- **Plugins**: Each package has `.claude-plugin/plugin.json`. Root marketplace (`/.claude-plugin/marketplace.json`) lists all 3 plugins.

### Recent Decisions

- **Don't rewrite varp in Effect TS** — Pure/impure boundaries already clean, 96% coverage. Effect is right for kiste/kart (stateful services), plain TS is right for varp (stateless request/response).
- **Plugin cache keys on version** — Bump version in plugin.json for cache to pick up new files.
- **Keep kart + kiste co-change DBs separate** — kart reads `.varp/cochange.db` (weighted edges from varp's analysis), kiste reads `.kiste/index.sqlite` (live Jaccard from git history). Different purposes, no unification needed.
- **MCP response compaction** — Presentation-layer helpers strip debug metadata and noise before returning to agents. Domain functions unchanged.

## Completed Work

### ~~Priority 1: Commit Hygiene~~ ✅

`.gitignore` committed in `46ed05c`. Plan docs clean.

### ~~Priority 3: Cross-Plugin Integration~~ ✅

- `varp_suggest_touches` enriched with kiste co-change data via `readKisteCoChanges` (direct SQLite, no kiste dep).
- kiste+varp e2e test: subprocess-based test exercises real kiste indexer → varp `readKisteCoChanges` pipeline.
- kiste tag ↔ varp component bridge: skipped (tags already roughly match component names, formal bridge adds coupling for marginal benefit).
- kart ↔ kiste co-change overlap: assessed, kept separate (see decision above).
- Unified marketplace: consolidated to root `/.claude-plugin/marketplace.json`. Deleted kiste's redundant per-package marketplace.

### ~~Priority 5: Kiste Enhancements~~ ✅

- `kiste_tag` write tool: agents can add/remove tags on artifacts without git commits.
- Better default `stop_tags`: added `__tests__`, `test`, `tests`, `cache`, `build`, `coverage`, `.turbo`.
- `/kiste:context` skill fix: added missing `kiste_get_cochange` to tool reference.
- MCP response compaction: stripped noise from `kiste_list_artifacts`, `kiste_get_artifact`, `kiste_search`, `kiste_get_provenance`.

### ~~Priority 6: Kart Enhancements~~ ✅

- Compact directory zoom: level 0 returns export counts via oxc-parser (no LSP, fast). Level 1+ retains full LSP behavior.
- MCP integration tests: added `kart_deps`, `kart_workspace_symbol`, `kart_inlay_hints` (301 total tests).
- Co-change enrichment: skipped (varp's coupling builder already does conventional commit weighting via `typeMultipliers`).
- MCP response compaction: `compactFind`, `compactImpact`, `compactDeps` strip debug metadata and relativize URIs.

### ~~Priority 4: Publishing Prep~~ ✅

- Release workflow: `.github/workflows/release.yml` using `changesets/action`.
- Root `package.json`: added `version` and `release` scripts.
- `@vevx/kiste`: added `exports` field (`./mcp` → `dist/Mcp.js`).
- All packages have `repository`, `license`, `engines`, `files` fields.

## On Hold

### Priority 2: Audit Plugin

The audit package has no plugin structure. It's the most complex package (orchestrator, agents, planner, report) and the furthest from being usable as a plugin. **On hold** — not blocking any other work.

**When to pick up:**
- After the core 3 packages are published and stable
- When there's user demand for audit as a plugin

**Tasks (when resumed):**
1. Create `packages/audit/.claude-plugin/plugin.json`
2. Design skills — likely `/audit:run` (run audit against codebase), `/audit:review` (review findings)
3. Consider MCP tools or keep CLI-only (audit is a heavy operation, may not suit MCP request/response)
4. Add to root marketplace
5. Audit depends on `@vevx/varp` — ensure the dependency works post-consolidation (`@vevx/varp/lib` import path)

## How to Pick Up

1. Run `turbo build && turbo test` to verify everything passes
2. Read `CLAUDE.md` for conventions and architecture overview
3. Read `packages/<pkg>/README.md` for per-package context
4. To publish: configure `NPM_TOKEN` secret in GitHub repo settings, then merge a changeset PR
