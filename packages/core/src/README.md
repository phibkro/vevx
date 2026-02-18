# Core Interface

Varp's MCP server. Exposes manifest operations, scheduling logic, plan validation, capability enforcement, and doc freshness tracking as MCP tools that the orchestrator (Claude Code) calls during its work cycle.

Consumed by: orchestrator (Claude Code session), skills, hooks.

## MCP Tools

### Manifest

#### `varp_read_manifest`

Reads and validates `varp.yaml`. Returns typed manifest with component registry, dependency graph, and doc references. Returns error on schema violations.

**Parameters:** `{ manifest_path?: string }` (defaults to `./varp.yaml`)

**Returns:** `Manifest`

#### `varp_resolve_docs`

Given a task's `touches` declaration, returns the doc paths to load based on the README.md convention:
- Docs where `basename === 'README.md'` are public — loaded for reads AND writes
- All other docs are private — loaded for writes only
- Auto-discovers `{component.path}/README.md` if it exists on disk

This is the core context resolution logic — it ensures each task gets exactly the information it needs.

**Parameters:** `{ manifest_path?: string, reads?: string[], writes?: string[] }`

**Returns:** `ResolvedDocs`

#### `varp_invalidation_cascade`

Given a list of components whose docs changed, walks `deps` to return all transitively affected components. Used by the orchestrator after task completion to flag stale contexts.

**Parameters:** `{ manifest_path?: string, changed: string[] }`

**Returns:** `string[]`

#### `varp_check_freshness`

Returns freshness status for all component docs — last modified timestamps, staleness relative to source code changes. Doc files and test files (`*.test.ts`, `*.spec.ts`, etc.) are excluded from the source mtime scan — doc edits would inflate source mtime, and test changes don't affect interfaces that docs describe. A 5-second tolerance threshold eliminates false positives from batch edits. Used by `/status` and by the orchestrator before dispatching tasks.

**Parameters:** `{ manifest_path?: string }`

**Returns:** `FreshnessReport`

#### `varp_check_warm_staleness`

Checks whether components have been modified since a warm agent was last active. Compares source file mtimes (excluding doc files) against a baseline timestamp for each requested component. Used by the orchestrator before resuming a warm agent to verify its cached context is still valid.

**Parameters:** `{ manifest_path?: string, components: string[], since: string }`

**Returns:** `WarmStalenessResult`

### Plan

#### `varp_parse_plan`

Reads and validates `plan.xml`. Returns typed plan with metadata, contracts (preconditions, invariants, postconditions with verify commands), and task graph with `touches` declarations. Returns error on schema violations.

**Parameters:** `{ path: string }`

**Returns:** `Plan`

#### `varp_validate_plan`

Checks plan consistency against the manifest:
- All components referenced in `touches` exist in the manifest
- Write targets are reachable through `deps`
- No tasks reference unknown components
- Task IDs are unique

**Parameters:** `{ plan_path: string, manifest_path?: string }`

**Returns:** `ValidationResult`

#### `varp_parse_log`

Parses execution `log.xml` (written by `/varp:execute` skill) into a typed structure with session metadata, per-task metrics, postcondition check results, observations, file modifications, invariant checks, and wave status.

**Parameters:** `{ path: string }`

**Returns:** `ExecutionLog`

#### `varp_diff_plan`

Structurally diffs two parsed plans. Compares metadata, contracts (by ID), and tasks (by ID) — reports added, removed, and modified entries with field-level detail.

**Parameters:** `{ plan_a_path: string, plan_b_path: string }`

**Returns:** `PlanDiff`

### Scheduler

#### `varp_compute_waves`

Pure function. Takes tasks with `touches` and optional `mutexes` declarations, detects data hazards (RAW/WAR/WAW) and mutex conflicts (MUTEX), and groups tasks into execution waves where no two concurrent tasks write to the same component or hold the same mutex.

Within each wave, tasks are safe to run in parallel. Waves execute sequentially. Tasks on the critical path (longest RAW dependency chain) are ordered first within each wave.

**Parameters:** `{ tasks: { id, touches, mutexes? }[] }`

**Returns:** `Wave[]`

### Analysis

#### `varp_scan_links`

Scans component docs for markdown links. Infers cross-component dependencies from links, detects broken links, and compares against declared `deps` in the manifest.

**Parameters:** `{ manifest_path?: string, mode: "deps" | "integrity" | "all" }`

**Returns:** `LinkScanResult`

#### `varp_infer_imports`

Scans `.ts/.tsx/.js/.jsx` source files for import statements. Resolves tsconfig `paths` aliases (e.g. `#shared/*`) in addition to relative imports. Infers cross-component dependencies from static imports, compares against declared `deps` in the manifest (producing `missing_deps` and `extra_deps`).

**Parameters:** `{ manifest_path?: string }`

**Returns:** `ImportScanResult`

#### `varp_suggest_touches`

Given file paths that will be modified, suggests a `touches` declaration using ownership mapping (files → write components) and import dependency inference (write components → read components).

**Parameters:** `{ manifest_path?: string, file_paths: string[] }`

**Returns:** `Touches`

#### `varp_suggest_components`

Analyzes a project directory to suggest multi-path component groupings. Supports three detection modes:
- **layers**: Scans layer directories (controllers, services, etc.) for files with common name stems across 2+ layers
- **domains**: Scans for domain directories containing 2+ layer subdirectories (e.g. `auth/controllers/`, `auth/services/`)
- **auto** (default): Runs both modes and merges results, deduplicating by name (layer results take priority)

**Parameters:** `{ root_dir: string, layer_dirs?: string[], suffixes?: string[], mode?: "layers" | "domains" | "auto" }`

**Returns:** `SuggestComponentsResult`

#### `varp_scoped_tests`

Finds test files for a given `touches` declaration. For write components, recursively finds all `*.test.ts` files under the component's path. Read components are excluded by default but can be included via `include_read_tests`. Collects `env` fields from all covered components into `required_env` (deduplicated, sorted). When `tags` is provided, only components whose `tags` intersect with the filter are processed. Returns file paths, a ready-to-run `bun test` command, and required environment variables.

**Parameters:** `{ manifest_path?: string, reads?: string[], writes?: string[], include_read_tests?: boolean, tags?: string[] }`

**Returns:** `ScopedTestResult`

#### `varp_lint`

Runs all health checks against the manifest: import dependency verification, link integrity scanning, doc freshness checking, and stability analysis. Stability checks warn when a `stable` component has no explicit `test` command (relies on auto-discovery) and when an `experimental` component is depended on by a `stable` component.

**Parameters:** `{ manifest_path?: string }`

**Returns:** `LintReport`

#### `varp_render_graph`

Renders the manifest dependency graph as Mermaid diagram syntax. Annotates nodes with stability badges (🟢 stable, 🟡 active, 🔴 experimental).

**Parameters:** `{ manifest_path?: string, direction?: "TD" | "LR" }`

**Returns:** `{ mermaid: string }`

#### `varp_watch_freshness`

Checks freshness and returns changes since a given baseline timestamp. Only returns components/docs whose source or doc was modified after the baseline. Omit `since` for an initial full snapshot of stale docs. The caller polls by passing the returned `snapshot_time` as `since` on the next call.

**Parameters:** `{ manifest_path?: string, since?: string }`

**Returns:** `WatchFreshnessResult`

#### `varp_check_env`

Checks environment variables required by a set of components. Collects `env` fields from the named components, deduplicates, and checks which are set vs missing in the current process environment.

**Parameters:** `{ manifest_path?: string, components: string[] }`

**Returns:** `EnvCheckResult`

### Enforcement

#### `varp_verify_capabilities`

After a subagent completes, verifies that actual file modifications fall within the declared `touches` write set. Checks git diff against component path boundaries from the manifest. Returns violations if the subagent modified files outside its declared scope. When component paths overlap, the most specific (longest) path matches first.

Used at orchestrator step 8 — before merge, not after.

**Parameters:** `{ manifest_path?: string, reads?: string[], writes?: string[], diff_paths: string[] }`

**Returns:** `CapabilityReport`

#### `varp_derive_restart_strategy`

Given a failed task and the current execution state, derives the appropriate restart strategy from the `touches` and `mutexes` dependency graph:
- **Isolated retry** — failed task's write set and mutex set are disjoint from all active downstream tasks
- **Cascade restart** — failed task's output is consumed by dispatched downstream tasks, or they share mutexes
- **Escalate** — failure indicates a planning problem, not an execution problem

This is a mechanical decision derived from `touches` and `mutexes`, not a judgment call.

**Parameters:** `{ failed_task: { id, touches, mutexes? }, all_tasks: { id, touches, mutexes? }[], completed_task_ids: string[], dispatched_task_ids: string[] }`

**Returns:** `RestartStrategy`

## Skills

Skill names omit the `varp-` prefix — the plugin's namespace (`/varp:`) provides the prefix automatically.

### `/init`

Project bootstrapping. Scans an existing codebase to scaffold `varp.yaml`. Tries three strategies in priority order: import from monorepo tool graph (Nx, Turborepo, moon), parse workspace config files (pnpm, npm, tsconfig), or fall back to filesystem scanning. Infers component dependencies from imports, discovers existing docs, and validates the generated manifest.

### `/plan [feature-name]`

Planning workflow. Loads the planner protocol (design doc section 3.2.1) and the manifest, turning the session into a planning conversation. Clarifies intent, decomposes into tasks, derives `touches`, writes contracts, outputs `plan.xml`.

### `/execute`

Execution workflow. Loads the orchestrator protocol and the active plan from `~/.claude/projects/<project>/memory/plans/`. Follows an 11-step chain of thought: select, verify preconditions, resolve context, dispatch, collect, verify freshness, verify capabilities, verify invariants, handle failure, invalidate, advance. Writes `log.xml` as it progresses.

### `/review`

Medium loop decision surface. Diffs the active plan's expected outcomes against `log.xml` — what completed, what failed, what was flagged uncertain, which docs were invalidated. Includes execution metrics: per-task resource consumption, failure rates, restart decisions.

### `/status`

Project state report. Shows active plan progress, component doc freshness, detected hazards, critical path, and any stale dependencies.

## Hooks

### `SubagentStart`

Injects static project conventions from `.claude/rules/subagent-conventions.md` into subagent context. Dynamic doc injection (component-specific docs based on `touches`) happens in the `/varp:execute` skill before dispatching subagents, not in this hook.

### `PostToolUse` (on Write/Edit)

After file writes, checks if the modified file falls within a component's path. If so, flags that component's docs for freshness review.

### `SessionStart`

Loads the manifest and displays project state — active plan, doc freshness, any warnings.

## Types

```typescript
interface Manifest {
  varp: string
  components: Record<string, Component>
}

type Stability = 'stable' | 'active' | 'experimental'

interface Component {
  path: string | string[]  // single directory or multiple directories
  deps?: string[]
  docs: string[]  // file paths (strings, not objects)
  tags?: string[]
  test?: string   // custom test command (overrides *.test.ts discovery)
  env?: string[]
  stability?: Stability
}

interface Touches {
  reads?: string[]
  writes?: string[]
}

interface ResolvedDocs {
  docs: { component: string; doc: string; path: string }[]
}

interface FreshnessReport {
  components: Record<string, {
    docs: Record<string, { path: string; last_modified: string; stale: boolean }>
    source_last_modified: string
  }>
}

interface Plan {
  metadata: { feature: string; created: string }
  contract: Contract
  tasks: Task[]
}

interface Contract {
  preconditions: Condition[]
  invariants: Invariant[]
  postconditions: Condition[]
}

interface Condition {
  id: string
  description: string
  verify: string  // shell command, exit 0 = pass
}

interface Invariant extends Condition {
  critical: boolean
}

interface Task {
  id: string
  description: string
  action: string
  values: string[]
  touches: Touches
}

interface Wave {
  id: number
  tasks: Task[]  // ordered by critical path priority
}

interface Hazard {
  type: 'RAW' | 'WAR' | 'WAW'
  source_task_id: string
  target_task_id: string
  component: string
}

interface CriticalPath {
  task_ids: string[]   // ordered chain, longest RAW dependency path
  length: number       // number of tasks in the chain
}

interface CapabilityReport {
  valid: boolean
  violations: {
    path: string
    declared_component: string | null  // null = outside any component
    actual_component: string
  }[]
}

interface RestartStrategy {
  strategy: 'isolated_retry' | 'cascade_restart' | 'escalate'
  reason: string
  affected_tasks: string[]  // task IDs impacted by cascade, empty for isolated/escalate
}

interface LinkScanResult {
  inferred_deps: InferredDep[]
  missing_deps: InferredDep[]    // inferred from links but not in manifest deps
  extra_deps: { from: string; to: string }[]  // in manifest deps but not inferred
  broken_links: BrokenLink[]
  missing_docs: string[]
  total_links_scanned: number
  total_docs_scanned: number
}

interface ImportScanResult {
  import_deps: ImportDep[]
  missing_deps: ImportDep[]      // inferred from imports but not in manifest deps
  extra_deps: { from: string; to: string }[]  // in manifest deps but not inferred
  total_files_scanned: number
  total_imports_scanned: number
  components_with_source: string[]  // components that had source files to scan
}

interface ImportDep {
  from: string
  to: string
  evidence: { source_file: string; import_specifier: string }[]
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

interface PlanDiff {
  metadata: MetadataChange[]
  contracts: ContractChange[]
  tasks: TaskChange[]
}

interface MetadataChange {
  field: string
  old_value: string
  new_value: string
}

interface ContractChange {
  id: string
  section: 'preconditions' | 'invariants' | 'postconditions'
  type: 'added' | 'removed' | 'modified'
  old_value?: { description: string; verify: string; critical?: boolean }
  new_value?: { description: string; verify: string; critical?: boolean }
}

interface TaskChange {
  id: string
  type: 'added' | 'removed' | 'modified'
  changes?: { field: string; old_value: unknown; new_value: unknown }[]
}

interface ScopedTestResult {
  test_files: string[]           // absolute paths to *.test.ts files
  components_covered: string[]   // component names that contributed tests
  run_command: string            // "bun test path1 path2 ..." (relative paths, empty if no tests)
  custom_commands: string[]      // custom test commands from component `test` fields
  required_env: string[]         // deduplicated env vars from covered components' `env` fields
}

interface LintReport {
  total_issues: number
  issues: LintIssue[]
}

interface LintIssue {
  severity: 'error' | 'warning'
  category: 'imports' | 'links' | 'freshness' | 'stability'
  message: string
  component?: string
}

interface SuggestedComponent {
  name: string
  path: string[]            // layer directory names
  evidence: { stem: string; files: string[] }[]
}

interface SuggestComponentsResult {
  components: SuggestedComponent[]
  layer_dirs_scanned: string[]
}

interface EnvCheckResult {
  required: string[]   // all env vars from the components' `env` fields (deduplicated, sorted)
  set: string[]        // subset of required that are present in process.env
  missing: string[]    // subset of required that are missing from process.env
}

interface ExecutionLog {
  session: { started: string; mode: 'single-scope' | 'sequential' | 'parallel' }
  tasks: TaskLog[]
  invariant_checks: InvariantCheck[]
  waves: WaveLog[]
}

interface TaskLog {
  id: string
  status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED' | 'NEEDS_REPLAN'
  metrics: { tokens: number; minutes: number; tools: number }
  files_modified: string[]
  postconditions: { id: string; result: 'pass' | 'fail' }[]
  observations: string[]
}

interface InvariantCheck {
  wave: number
  checks: { description: string; result: 'pass' | 'fail' }[]
}

interface WaveLog {
  id: number
  status: 'complete' | 'incomplete'
}

interface WatchFreshnessResult {
  changes: FreshnessChange[]
  snapshot_time: string
  total_stale: number
}

interface FreshnessChange {
  component: string
  doc: string
  became_stale: boolean
  source_modified: string
  doc_modified: string
}

interface WarmStalenessResult {
  safe_to_resume: boolean              // true if no components were modified
  stale_components: {
    component: string
    source_last_modified: string       // ISO timestamp
  }[]
  summary: string                      // human-readable for injection into agent prompt
}

interface ExecutionMetrics {
  task_id: string
  tokens_used: number
  minutes_elapsed: number
  tools_invoked: number
  files_modified: string[]
  exit_status: 'COMPLETE' | 'PARTIAL' | 'BLOCKED' | 'NEEDS_REPLAN'
  restart_count: number
  capability_violations: number
}
```
