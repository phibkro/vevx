# Scheduler

Deterministic scheduling algorithms for task dependency analysis and parallel execution planning.

## Tools

| Tool | Function | Purpose |
|------|----------|---------|
| `varp_detect_hazards` | `detectHazards()` | Find RAW/WAR/WAW data hazards between tasks |
| `varp_compute_waves` | `computeWaves()` | Group tasks into parallel execution waves |
| `varp_compute_critical_path` | `computeCriticalPath()` | Find the longest RAW dependency chain |

## Algorithms

**Hazard detection** — O(n²) pairwise comparison of task `touches` declarations. Classifies conflicts as RAW (read-after-write), WAR (write-after-read), or WAW (write-after-write) on shared components.

**Wave computation** — Topological sort over RAW dependencies. Tasks within the same wave have no data dependencies and can execute in parallel. WAR/WAW hazards are warnings, not blockers.

**Critical path** — Memoized dynamic programming over RAW chains. Returns the longest dependency sequence. Used to estimate minimum sequential execution depth.

## Data Flow

All three functions accept a task array with `touches` (reads/writes) declarations. Input comes from a parsed `plan.xml`. Output is pure JSON — no side effects.
