# Core Interface

Varp's MCP server. Exposes manifest operations, scheduling logic, plan validation, and doc freshness tracking as MCP tools that the orchestrator (Claude Code) calls during its work cycle.

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

Returns freshness status for all component docs — last modified timestamps, staleness relative to source code changes. Used by `/varp-status` and by the orchestrator before dispatching tasks.

**Parameters:** `{ manifest: Manifest }`

**Returns:** `FreshnessReport`

### Plan

#### `varp_parse_plan`

Reads and validates `plan.xml`. Returns typed plan with metadata, contracts (preconditions, invariants, postconditions with verify commands), and task graph with `touches` declarations. Returns error on schema violations.

**Parameters:** `{ path: string }`

**Returns:** `Plan`

#### `varp_validate_plan`

Checks plan consistency against the manifest:
- All components referenced in `touches` exist in the manifest
- Write targets are reachable through `depends_on`
- No tasks reference unknown components

**Parameters:** `{ plan: Plan, manifest: Manifest }`

**Returns:** `ValidationResult`

### Scheduler

#### `varp_compute_waves`

Pure function. Takes tasks with `touches` declarations, detects data hazards (RAW/WAR/WAW), and groups tasks into execution waves where no two concurrent tasks write to the same component.

Within each wave, tasks are safe to run in parallel. Waves execute sequentially.

**Parameters:** `{ tasks: Task[] }`

**Returns:** `Wave[]`

#### `varp_detect_hazards`

Diagnostic function. Returns all detected data hazards between tasks:
- `RAW` — true dependency (read after write), enforces ordering
- `WAR` — anti-dependency (write after read), resolved by context snapshotting
- `WAW` — output dependency (write after write), scheduling constraint or plan smell

Used by the planner and `/varp-status` to surface potential issues before execution.

**Parameters:** `{ tasks: Task[] }`

**Returns:** `Hazard[]`

## Skills

### `/varp-plan [feature-name]`

Planning workflow. Loads the manifest, initiates a clarifying conversation with the human, and produces `plan.xml` in the appropriate backlog directory.

### `/varp-execute`

Execution workflow. Loads the in-progress plan, computes waves via `varp_compute_waves`, walks the task graph dispatching subagents, writes `log.xml` as it progresses.

### `/varp-review`

Medium loop decision surface. Diffs the active plan's expected outcomes against `log.xml` — what completed, what failed, what was flagged uncertain, which docs were invalidated.

### `/varp-status`

Project state report. Shows active plan progress, component doc freshness, detected hazards, and any stale dependencies.

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
}

interface Wave {
  id: number
  tasks: Task[]
}

interface Hazard {
  type: 'RAW' | 'WAR' | 'WAW'
  source: Task
  target: Task
  component: string
}

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}
```
