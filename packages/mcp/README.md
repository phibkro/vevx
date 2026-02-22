# Varp MCP Server

MCP server exposing manifest operations, scheduling logic, plan validation, capability enforcement, coupling analysis, and doc freshness tracking as tools. Consumed by the orchestrator (Claude Code session) during its work cycle.

## Quick Reference

```
bun run start                    # Start MCP server (stdio transport)
bun test                         # Run integration tests
bun run check                    # Format + lint + build
```

## Tools (23)

All tools accept `manifest_path?: string` (defaults to `./varp.yaml`) unless noted. All have [tool annotations](https://modelcontextprotocol.io/docs/concepts/tools#tool-annotations): 22 are `readOnlyHint: true`, 1 (`varp_ack_freshness`) writes. All are `idempotentHint: true`, `openWorldHint: false`. Five tools provide `outputSchema` for structured responses.

### Health (composite)

#### `varp_health`

Project health check combining manifest parsing, doc freshness, and lint. Ideal session-start tool.

**Parameters:** `{ manifest_path?, mode?: "manifest" | "freshness" | "lint" | "all" }`

- `"manifest"` — parse and validate `varp.yaml`, check dependency graph for cycles
- `"freshness"` — doc staleness relative to source changes (excludes doc/test files from mtime scan, 5s tolerance)
- `"lint"` — import deps, link integrity, doc freshness, stability analysis
- `"all"` (default) — all three in one call

**Returns:** `{ manifest?, freshness?, lint? }` — keys present based on mode

### Manifest

#### `varp_resolve_docs`

Given a task's `touches` declaration, returns doc paths to load. README.md is public (loaded for reads and writes), other docs are private (writes only). Auto-discovers `{component.path}/README.md`.

**Parameters:** `{ manifest_path?, reads?: string[], writes?: string[] }` — accept component names or tags.

**Returns:** `ResolvedDocs`

#### `varp_invalidation_cascade`

Walks `deps` to return all transitively affected components given changed components. Has `outputSchema`.

**Parameters:** `{ manifest_path?, changed: string[] }` — accepts component names or tags.

**Returns:** `{ affected: string[] }`

#### `varp_ack_freshness`

Acknowledges docs as reviewed and still accurate. Records timestamp in `.varp/freshness.json`. The only write tool. Has `outputSchema`.

**Parameters:** `{ manifest_path?, components: string[], doc?: string }` — accepts component names or tags.

**Returns:** `{ acked: string[] }`

#### `varp_check_warm_staleness`

Checks whether components have been modified since a warm agent was last active. Used before resuming a warm agent.

**Parameters:** `{ manifest_path?, components: string[], since: string }` — accepts component names or tags.

**Returns:** `WarmStalenessResult`

#### `varp_list_files`

Lists source files for given components or tags. Reverse lookup for `varp_suggest_touches` (files->components). Has `outputSchema`.

**Parameters:** `{ manifest_path?, components: string[] }` — accepts component names or tags.

**Returns:** `{ files: Array<{ component, paths }>, total }`

### Plan

#### `varp_parse_plan`

Parses `plan.xml` into typed structure with metadata, contracts, and task graph.

**Parameters:** `{ path: string }`

**Returns:** `Plan`

#### `varp_validate_plan`

Checks plan consistency against manifest: touches reference known components, unique task IDs, write targets reachable through deps.

**Parameters:** `{ plan_path: string, manifest_path? }`

**Returns:** `ValidationResult`

#### `varp_parse_log`

Parses execution `log.xml` into typed structure with task metrics, postcondition checks, and wave status.

**Parameters:** `{ path: string }`

**Returns:** `ExecutionLog`

#### `varp_diff_plan`

Structurally diffs two plans by metadata, contracts (by ID), and tasks (by ID).

**Parameters:** `{ plan_a_path: string, plan_b_path: string }`

**Returns:** `PlanDiff`

### Scheduler (composite)

#### `varp_schedule`

Task scheduling analysis: compute execution waves, detect data hazards, find critical path.

**Parameters:** `{ tasks: TaskDefinition[], mode?: "waves" | "hazards" | "critical_path" | "all" }`

- `"waves"` — group tasks into parallel-safe execution waves
- `"hazards"` — detect RAW/WAR/WAW data hazards and MUTEX conflicts
- `"critical_path"` — longest RAW dependency chain
- `"all"` (default) — all three (computes hazards once, passes to critical path)

**Returns:** `{ waves?, hazards?, critical_path? }` — keys present based on mode

### Coupling (composite)

#### `varp_coupling`

Component coupling analysis combining git co-change (behavioral) and import (structural) signals.

**Parameters:** `{ manifest_path?, mode?: "co_changes" | "matrix" | "hotspots" | "all", component?, structural_threshold?, behavioral_threshold?, limit?, max_commit_files?, skip_message_patterns?, exclude_paths? }`

- `"co_changes"` — raw git co-change graph (cached in `.varp/co-change.json`)
- `"matrix"` — coupling matrix classifying pairs into quadrants (explicit_module, stable_interface, hidden_coupling, unrelated). Thresholds auto-calibrate to median.
- `"hotspots"` — hidden coupling hotspots sorted by behavioral weight
- `"all"` (default) — all three

**Returns:** `{ co_changes?, matrix?, hotspots?, total_hotspots? }` — keys present based on mode

### Analysis

#### `varp_build_codebase_graph`

Builds a complete `CodebaseGraph` combining manifest, co-change, imports, and optional coupling matrix.

**Parameters:** `{ manifest_path?, with_coupling?: boolean }`

**Returns:** `CodebaseGraph`

#### `varp_scan_links`

Scans component docs for markdown links. Infers dependencies, detects broken links, compares against declared deps.

**Parameters:** `{ manifest_path?, mode: "deps" | "integrity" | "all" }`

**Returns:** `LinkScanResult`

#### `varp_infer_imports`

Scans source files for import statements. Resolves tsconfig `paths` aliases. Infers cross-component dependencies.

**Parameters:** `{ manifest_path? }`

**Returns:** `ImportScanResult`

#### `varp_suggest_touches`

Given file paths, suggests a `touches` declaration using ownership mapping and import dependency inference.

**Parameters:** `{ manifest_path?, file_paths: string[] }`

**Returns:** `Touches`

#### `varp_suggest_components`

Analyzes a project to suggest component groupings via five detection strategies: workspace packages, container dirs, indicator dirs, layers, and domains.

**Parameters:** `{ root_dir: string, layer_dirs?, suffixes?, mode?: "layers" | "domains" | "auto" }`

**Returns:** `SuggestComponentsResult`

#### `varp_scoped_tests`

Finds test files for a `touches` declaration. Returns file paths, a `bun test` command, and required env vars.

**Parameters:** `{ manifest_path?, reads?, writes?, include_read_tests?, tags? }`

**Returns:** `ScopedTestResult`

#### `varp_render_graph`

Renders the manifest dependency graph as Mermaid, ASCII, or tag groups. Annotates with stability badges and tags.

**Parameters:** `{ manifest_path?, direction?, format?, tags?, stability? }`

**Returns:** `{ mermaid }` or `{ ascii }` or `{ tag_groups }`

#### `varp_watch_freshness`

Returns freshness changes since a baseline timestamp. Omit `since` for initial snapshot.

**Parameters:** `{ manifest_path?, since?: string }`

**Returns:** `WatchFreshnessResult`

#### `varp_check_env`

Checks required environment variables for components. Has `outputSchema`.

**Parameters:** `{ manifest_path?, components: string[] }` — accepts component names or tags.

**Returns:** `EnvCheckResult`

### Enforcement

#### `varp_verify_capabilities`

Verifies file modifications fall within declared `touches` write set. Has `outputSchema`.

**Parameters:** `{ manifest_path?, reads?, writes?, diff_paths: string[] }` — `reads`/`writes` accept component names or tags.

**Returns:** `CapabilityReport`

#### `varp_derive_restart_strategy`

Derives restart strategy for a failed task: `isolated_retry`, `cascade_restart`, or `escalate`.

**Parameters:** `{ failed_task: TaskDefinition, all_tasks: TaskDefinition[], completed_task_ids: string[], dispatched_task_ids: string[] }`

**Returns:** `RestartStrategy`
