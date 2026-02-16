# Core Interface

Varp's MCP server. Exposes manifest operations, scheduling logic, plan validation, capability enforcement, and doc freshness tracking as MCP tools that the orchestrator (Claude Code) calls during its work cycle.

Consumed by: orchestrator (Claude Code session), skills, hooks.

## MCP Tools

### Manifest

#### `varp_read_manifest`

Reads and validates `varp.yaml`. Returns typed manifest with component registry, dependency graph, and doc references. Returns error on schema violations.

**Parameters:** `{ path?: string }` (defaults to `./varp.yaml`)

**Returns:** `Manifest`

#### `varp_resolve_docs`

Given a task's `touches` declaration, returns the doc paths to load:
- Components in `writes` → both interface and internal doc paths
- Components in `reads` → interface doc paths only

This is the core context resolution logic — it ensures each task gets exactly the information it needs.

**Parameters:** `{ manifest: Manifest, touches: Touches }`

**Returns:** `ResolvedDocs`

#### `varp_invalidation_cascade`

Given a list of components whose interface docs changed, walks `depends_on` to return all transitively affected components. Used by the orchestrator after task completion to flag stale contexts.

**Parameters:** `{ manifest: Manifest, changed: string[] }`

**Returns:** `string[]`

#### `varp_check_freshness`

Returns freshness status for all component docs — last modified timestamps, staleness relative to source code changes. Used by `/status` and by the orchestrator before dispatching tasks.

**Parameters:** `{ manifest: Manifest }`

**Returns:** `FreshnessReport`

### Plan

#### `varp_parse_plan`

Reads and validates `plan.xml`. Returns typed plan with metadata, contracts (preconditions, invariants, postconditions with verify commands), task graph with `touches` declarations, and per-task resource budgets. Returns error on schema violations.

**Parameters:** `{ path: string }`

**Returns:** `Plan`

#### `varp_validate_plan`

Checks plan consistency against the manifest:
- All components referenced in `touches` exist in the manifest
- Write targets are reachable through `depends_on`
- No tasks reference unknown components
- Task IDs are unique
- Budget values are positive

**Parameters:** `{ plan: Plan, manifest: Manifest }`

**Returns:** `ValidationResult`

### Scheduler

#### `varp_compute_waves`

Pure function. Takes tasks with `touches` declarations, detects data hazards (RAW/WAR/WAW), and groups tasks into execution waves where no two concurrent tasks write to the same component.

Within each wave, tasks are safe to run in parallel. Waves execute sequentially. Tasks on the critical path (longest RAW dependency chain) are ordered first within each wave.

**Parameters:** `{ tasks: Task[] }`

**Returns:** `Wave[]`

#### `varp_detect_hazards`

Diagnostic function. Returns all detected data hazards between tasks:
- `RAW` — true dependency (read after write), enforces ordering
- `WAR` — anti-dependency (write after read), resolved by context snapshotting
- `WAW` — output dependency (write after write), scheduling constraint or plan smell

Used by the planner and `/status` to surface potential issues before execution.

**Parameters:** `{ tasks: Task[] }`

**Returns:** `Hazard[]`

#### `varp_compute_critical_path`

Returns the longest chain of RAW dependencies from any root task to any leaf task. Used by the orchestrator to prioritize dispatch order when multiple tasks are eligible within a wave.

**Parameters:** `{ tasks: Task[] }`

**Returns:** `CriticalPath`

### Enforcement

#### `varp_verify_capabilities`

After a subagent completes, verifies that actual file modifications fall within the declared `touches` write set. Checks git diff against component path boundaries from the manifest. Returns violations if the subagent modified files outside its declared scope.

Used at orchestrator step 8 — before merge, not after.

**Parameters:** `{ manifest: Manifest, touches: Touches, diff_paths: string[] }`

**Returns:** `CapabilityReport`

#### `varp_derive_restart_strategy`

Given a failed task and the current execution state, derives the appropriate restart strategy from the `touches` dependency graph:
- **Isolated retry** — failed task's write set is disjoint from all downstream read sets
- **Cascade restart** — failed task's output is consumed by dispatched/completed downstream tasks
- **Escalate** — failure indicates a planning problem, not an execution problem

This is a mechanical decision derived from `touches`, not a judgment call.

**Parameters:** `{ failed_task: Task, all_tasks: Task[], completed_task_ids: string[], dispatched_task_ids: string[] }`

**Returns:** `RestartStrategy`

## Skills

Skill names omit the `varp-` prefix — the plugin's namespace (`/varp:`) provides the prefix automatically.

### `/plan [feature-name]`

Planning workflow. Loads the planner protocol (design doc section 3.2.1) and the manifest, turning the session into a planning conversation. Clarifies intent, decomposes into tasks, derives `touches`, sets budgets, writes contracts, outputs `plan.xml`.

### `/execute`

Execution workflow. Loads the orchestrator protocol (design doc section 3.4) and the active plan from `plans/in-progress/`. Follows the 14-step chain of thought: select → verify → load → budget → dispatch → monitor → collect → verify capabilities → review → handle failure → observe → update → invalidate → advance. Writes `log.xml` as it progresses.

### `/review`

Medium loop decision surface. Diffs the active plan's expected outcomes against `log.xml` — what completed, what failed, what was flagged uncertain, which docs were invalidated. Includes execution metrics: per-task resource consumption, failure rates, restart decisions.

### `/status`

Project state report. Shows active plan progress, component doc freshness, detected hazards, critical path, and any stale dependencies.

## Hooks

### `SubagentStart`

Auto-injects relevant component docs based on the current task's `touches` declaration. Calls `varp_resolve_docs` and appends the resolved doc content to the subagent's context.

### `PostToolUse` (on Write/Edit)

After file writes, checks if the modified file falls within a component's path. If so, flags that component's docs for freshness review.

### `SessionStart`

Loads the manifest and displays project state — active plan, doc freshness, any warnings.

## Types

```typescript
interface Manifest {
  version: string
  name: string
  components: Record<string, Component>
}

interface Component {
  path: string
  depends_on?: string[]
  docs: {
    interface: string
    internal: string
  }
}

interface Touches {
  reads?: string[]
  writes?: string[]
}

interface Budget {
  tokens: number
  minutes: number
}

interface ResolvedDocs {
  interface_docs: { component: string; path: string }[]
  internal_docs: { component: string; path: string }[]
}

interface FreshnessReport {
  components: Record<string, {
    interface_doc: { path: string; last_modified: string; stale: boolean }
    internal_doc: { path: string; last_modified: string; stale: boolean }
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
  budget: Budget
}

interface Wave {
  id: number
  tasks: Task[]  // ordered by critical path priority
}

interface Hazard {
  type: 'RAW' | 'WAR' | 'WAW'
  source: Task
  target: Task
  component: string
}

interface CriticalPath {
  tasks: Task[]      // ordered chain, longest RAW dependency path
  total_budget: Budget
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

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
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
