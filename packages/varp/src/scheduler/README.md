# Scheduler

Deterministic scheduling algorithms for task dependency analysis and parallel execution planning.

## Tools

| Tool                         | Function                | Purpose                                                         |
| ---------------------------- | ----------------------- | --------------------------------------------------------------- |
| `varp_detect_hazards`        | `detectHazards()`       | Find RAW/WAR/WAW data hazards and MUTEX conflicts between tasks |
| `varp_compute_waves`         | `computeWaves()`        | Group tasks into parallel execution waves                       |
| `varp_compute_critical_path` | `computeCriticalPath()` | Find the longest RAW dependency chain                           |

## Algorithms

**Hazard detection** — O(n²) pairwise comparison of task `touches` and `mutexes` declarations. Classifies conflicts as RAW (read-after-write), WAR (write-after-read), or WAW (write-after-write) on shared components, plus MUTEX (shared named mutex) for mutual exclusion constraints.

**Wave computation** — Topological sort over RAW + WAW + MUTEX dependencies. Tasks within the same wave have no data dependencies or mutex conflicts and can execute in parallel.

**Critical path** — Memoized dynamic programming over RAW chains. Returns the longest dependency sequence. Used to estimate minimum sequential execution depth.

## Data Flow

All three functions accept `TaskDefinition[]` — the minimal scheduling-relevant shape (`id`, `touches`, optional `mutexes`). The scheduler has no dependency on plan parsing. Callers extract task definitions from plans, CLI input, or any other source. Output is pure JSON — no side effects.
