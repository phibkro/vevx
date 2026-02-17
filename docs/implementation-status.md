# Implementation Status

Current state of Varp relative to the design documents. Updated February 2026.

## What's Built

| Layer | Details |
|-------|---------|
| MCP tools | Manifest, Scheduler, Plan, Enforcement, Analysis |
| Skills | init, plan, execute, review, status |
| Hooks | SessionStart, SubagentStart (PostToolUse), PostToolUse (freshness) |
| Tests | Co-located `*.test.ts` files, run with `bun test` |

### MCP Tools by Category

**Manifest:** `varp_read_manifest`, `varp_resolve_docs`, `varp_invalidation_cascade`, `varp_check_freshness`, `varp_scan_links`, `varp_infer_imports`, `varp_suggest_touches`, `varp_lint`

**Scheduler:** `varp_compute_waves`, `varp_detect_hazards`, `varp_compute_critical_path`

**Plan:** `varp_parse_plan`, `varp_validate_plan`, `varp_diff_plan`

**Enforcement:** `varp_verify_capabilities`, `varp_derive_restart_strategy`

**Analysis:** `varp_scoped_tests`

### Skills

| Skill | Status | Notes |
|-------|--------|-------|
| `/varp:init` | Complete | Scaffolds `varp.yaml`. Supports Nx, Turborepo, moon graph import. |
| `/varp:plan` | Complete | Planner protocol (9 steps). Suggests Turbo/Nx test runners. |
| `/varp:execute` | Complete | Orchestrator protocol (11 steps). Advisory monorepo scope checks. |
| `/varp:review` | Complete | Medium loop: diff plan vs log.xml. |
| `/varp:status` | Complete | Project state report. |

### Hooks

| Hook | Trigger | Purpose |
|------|---------|---------|
| SessionStart | Session start | Load manifest, display project state |
| SubagentStart | Subagent dispatch | Inject conventions from `.claude/rules/subagent-conventions.md` |
| PostToolUse (Write/Edit) | File modification | Flag component docs for freshness review |

## Changes from Design Doc

### Simplified Manifest Format

Design doc showed docs as objects with `load_on` tags. Implementation uses plain string paths with the README.md convention: docs named `README.md` are public (loaded for reads+writes), all others are private (loaded for writes only). Simpler, no metadata to maintain.

### Auto-Discovery

Not in original design. Components auto-discover `{path}/README.md` and `{path}/docs/*.md` without explicit `docs:` entries. The `docs:` field is only needed for docs outside the component's path tree.

### Monorepo Tool Integration

Added post-design. Three integration points:
- **init** imports dependency graphs from Nx, Turborepo, or moon CLI
- **plan** suggests monorepo-aware test runners for verification commands
- **execute** performs advisory scope checks via `nx affected` or `turbo query`

### Flat YAML Format

Design doc used `varp` as just another field. Implementation makes `varp` the version key and all other top-level keys are component names directly. No `components:` wrapper needed.

### Manifest Caching

Not in design doc. Parser caches by `(absolutePath, mtimeMs)` to avoid re-parsing on repeated tool calls within a session.

## What's Deferred

### From Design Doc

| Feature | Design Section | Status | Notes |
|---------|---------------|--------|-------|
| Git worktrees for parallel isolation | 4.3 | Deferred | Requires Claude Code worktree support |
| WAR context snapshotting | 4.2 | Deferred | Depends on worktree isolation |
| Prompt caching integration | 3.4 | Deferred | Requires Anthropic SDK cache breakpoint API |
| Batch API for verification | 3.4 | Deferred | Optimization, not blocking |
| Budget enforcement at runtime | 2.2 | Partial | Budgets declared in plans, tracked in skills, not enforced by MCP tools |
| Warm agent staleness detection | 7.7 | Open | Skills document the protocol, no automated check |
| Medium loop UX | 7.1 | Partial | `/varp:review` skill exists but UX is underspecified |
| Decision authority matrix | 7.3 | Open | Escalation thresholds need empirical tuning |

### Extensions (Not in Original Design Doc)

| Extension | Purpose | Status |
|-----------|---------|--------|
| `tags` on components | Freeform labels for filtering and grouping | Implemented |
| `test` on components | Per-component test command (overrides `*.test.ts` discovery in `varp_scoped_tests`) | Implemented |
| `env` on components | Runtime prerequisites (informational) | Implemented |
| `stability` on components | `stable` / `active` / `experimental` | Implemented |
| Three-graph separation | Project/task/action graph decomposition | Documented in architecture |
| Named mutexes on tasks | Exclusive resource locks beyond component graph | Under consideration |

## Architecture

See [Design Principles](design-principles.md) for foundations, [Architecture](design-architecture.md) for the full design, and [Internal Architecture](../src/docs/architecture.md) for module-level implementation details.
