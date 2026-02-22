# Implementation Status

Current state of Varp relative to the design documents. Updated February 2026.

## What's Built

| Layer     | Details                                                                                  |
| --------- | ---------------------------------------------------------------------------------------- |
| MCP tools | Manifest, Scheduler, Plan, Enforcement, Analysis                                         |
| Skills    | init, plan, execute, review, status                                                      |
| Hooks     | SessionStart, SubagentStart, PostToolUse (freshness + auto-format), Stop (lint advisory) |
| Tests     | Co-located `*.test.ts` files, run with `bun test`                                        |

### MCP Tools by Category

**Manifest:** `varp_read_manifest`, `varp_resolve_docs`, `varp_invalidation_cascade`, `varp_check_freshness`, `varp_check_warm_staleness`, `varp_scan_links`, `varp_infer_imports`, `varp_suggest_touches`, `varp_lint`, `varp_render_graph`, `varp_watch_freshness`

**Scheduler:** `varp_compute_waves`, `varp_detect_hazards`, `varp_compute_critical_path`

**Plan:** `varp_parse_plan`, `varp_validate_plan`, `varp_diff_plan`, `varp_parse_log`

**Enforcement:** `varp_verify_capabilities`, `varp_derive_restart_strategy`

**Analysis:** `varp_scoped_tests`, `varp_suggest_components`, `varp_check_env`

### Skills

| Skill           | Status   | Notes                                                                                                       |
| --------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `/varp:init`    | Complete | Scaffolds `varp.yaml`. Supports Nx, Turborepo, moon graph import. Scans root `docs/` for component matches. |
| `/varp:plan`    | Complete | Planner protocol (budget step removed per ADR-001). Suggests Turbo/Nx test runners.                         |
| `/varp:execute` | Complete | Orchestrator protocol. Advisory monorepo scope checks. OTel correlation guidance.                           |
| `/varp:review`  | Complete | Medium loop: diff plan vs log.xml. OTel dashboard guidance for external metrics.                            |
| `/varp:status`  | Complete | Project state report.                                                                                       |

### Hooks

| Hook                     | Trigger              | Type    | Purpose                                                             |
| ------------------------ | -------------------- | ------- | ------------------------------------------------------------------- |
| SessionStart             | Session start        | command | Load manifest, display project state and cost tracking status       |
| SubagentStart            | Subagent dispatch    | command | Inject conventions from `.claude/rules/subagent-conventions.md`     |
| PostToolUse (Write/Edit) | File modification    | command | Flag component docs for freshness review                            |
| PostToolUse (Write/Edit) | File modification    | command | Auto-format modified files with oxfmt                               |
| Stop                     | Claude finishes turn | prompt  | Run `varp_lint` to check for stale docs, broken links, missing deps |

## Changes from Design Doc

### Simplified Manifest Format

Design doc showed docs as objects with `load_on` tags. Implementation uses plain string paths with the README.md convention: docs named `README.md` are public (loaded for reads+writes), all others are private (loaded for writes only). Simpler, no metadata to maintain.

### Auto-Discovery

Not in original design. Components auto-discover `{path}/README.md` and `{path}/docs/*.md` without explicit `docs:` entries. The `docs:` field is only needed for docs outside the component's path tree. Src-collapse: when a component path ends in `src/`, discovery also checks the parent; when it has a `src/` child, discovery checks inside it. This makes `src/` transparent — docs can live at the package root.

### Monorepo Tool Integration

Added post-design. Three integration points:

- **init** imports dependency graphs from Nx, Turborepo, or moon CLI
- **plan** suggests monorepo-aware test runners for verification commands
- **execute** performs advisory scope checks via `nx affected` or `turbo query`

### Flat YAML Format

Design doc used `varp` as just another field. Implementation makes `varp` the version key and all other top-level keys are component names directly. No `components:` wrapper needed.

### Manifest Caching

Not in design doc. Parser caches by `(absolutePath, mtimeMs)` to avoid re-parsing on repeated tool calls within a session.

### Budget Removal ([ADR-001](../decisions/adr-001-budget-observability.md))

Design doc specified per-task token/time budgets enforced at runtime. Dropped entirely — `<budget>` elements removed from the plan schema, planner protocol, orchestrator chain of thought, and all tool/skill documentation. The parser silently ignores legacy `<budget>` elements for backward compatibility. Critical path returns chain length instead of summed budget. Resource consumption is tracked as execution metrics in `log.xml` (observability, not enforcement).

### Expanded Orchestrator Protocol

Design doc specified steps select through advance. Implementation adds:

- **Step 3b** (Check Environment Prerequisites): Verify component `env` fields before dispatch
- **Step 6** (Verify Freshness): Check doc freshness after task completion, resume subagent if stale
- **Step 7b** (Advisory Scope Check): Cross-check via `nx affected` or `turbo query` when monorepo tools available
- **Step 12** (Status Report): Generate freshness + lint snapshot on plan completion

### Cost Observability

Per-task and per-plan cost tracking via statusline snapshots. The execute skill reads `/tmp/claude/varp-cost.json` (written by a statusline command configured in `.claude/settings.json`) before and after each task dispatch, recording `cost_usd` deltas on task metrics and plan-level totals on the `<cost>` element. Falls back silently when the cost file isn't available.

Data source priority: OpenTelemetry (`CLAUDE_CODE_ENABLE_TELEMETRY=1`) provides the richest per-request data when an exporter is configured. The statusline approach is the in-session fallback. The session-start hook detects both sources and displays their status. See the [Claude Code monitoring docs](https://code.claude.com/docs/en/monitoring-usage) for OTel setup.

### Single Library Entry Point

Design doc (§3.4) described two entry points: `@vevx/varp/lib` (Bun-free, pure functions) and `@vevx/varp/bun` (Bun-dependent functions). These were collapsed into a single `@vevx/varp/lib` entry point that exports everything. The split was unnecessary — all consumers (`@vevx/audit`, `@vevx/varp`) already require Bun at runtime. One entry point, one hand-maintained `lib.d.ts`.

### MCP Server Delivery

Design doc (§3.4) describes the MCP server delivered via the plugin's `plugin.json`. The MCP server is now configured in `.mcp.json` at the project root, not in the plugin. The plugin cache copies files to `~/.claude/plugins/cache/`, which breaks relative paths to sibling packages (`../core/build/`). Moving the server config to `.mcp.json` uses project-relative paths that always resolve correctly and pick up the latest build without re-registration. The plugin now provides only skills and hooks.

## What's Deferred

### From Design Doc

| Feature                              | Design Section | Status      | Notes                                                                                           |
| ------------------------------------ | -------------- | ----------- | ----------------------------------------------------------------------------------------------- |
| Git worktrees for parallel isolation | 4.3            | Deferred    | Requires Claude Code worktree support                                                           |
| WAR context snapshotting             | 4.2            | Deferred    | Depends on worktree isolation                                                                   |
| Prompt caching integration           | 3.4            | Deferred    | Requires Anthropic SDK cache breakpoint API                                                     |
| Batch API for verification           | 3.4            | Deferred    | Optimization, not blocking                                                                      |
| ~~Budget enforcement at runtime~~    | 2.2            | Dropped     | Reframed as observability metrics — see [ADR-001](../decisions/adr-001-budget-observability.md) |
| Warm agent staleness detection       | 7.7            | Implemented | `varp_check_warm_staleness` tool checks component mtimes against baseline                       |
| Medium loop UX                       | 7.1            | Partial     | `/varp:review` skill exists but UX is underspecified                                            |
| Decision authority matrix            | 7.3            | Open        | Escalation thresholds need empirical tuning                                                     |

### Extensions (Not in Original Design Doc)

| Extension                 | Purpose                                                                             | Status                     |
| ------------------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| `tags` on components      | Freeform labels for filtering and grouping                                          | Implemented                |
| `test` on components      | Per-component test command (overrides `*.test.ts` discovery in `varp_scoped_tests`) | Implemented                |
| `env` on components       | Runtime prerequisites (informational)                                               | Implemented                |
| `stability` on components | `stable` / `active` / `experimental`                                                | Implemented                |
| Three-graph separation    | Project/task/action graph decomposition                                             | Documented in architecture |
| Named mutexes on tasks    | Exclusive resource locks beyond component graph                                     | Implemented                |
| OTel status detection     | Session-start hook detects `CLAUDE_CODE_ENABLE_TELEMETRY` and exporter config       | Implemented                |

### Type-Aware Linting

oxlint runs with `--type-aware` across all packages (via `oxlint-tsgolint`). Core replaces `tsc --noEmit` with `oxlint --type-aware --type-check` for type checking — faster and catches additional issues like floating promises, unsafe template expressions, and unbound methods. Audit and CLI use `--type-aware` for lint rules but keep `tsc` for declaration emit and type-checking respectively.

## Architecture

See [Design Principles](design-principles.md) for foundations, [Architecture](design-architecture.md) for the full design, and [Internal Architecture](../../packages/varp/docs/architecture.md) for module-level implementation details.
