# Varp Integration Notes

How varp's existing capabilities map to audit needs. Reference for when the repos merge.

## Varp Replaces (delete from audit code)

| Audit Code | Varp Replacement | Notes |
|---|---|---|
| `groupIntoComponents()` | Manifest components + `findOwningComponent()` | Varp uses longest-prefix match, supports multi-path components |
| `AuditComponent` type | `Component` from manifest schema | Varp has deps, tags, stability, test commands |
| Hardcoded 3-wave structure | `computeWaves()` from scheduler | Derives waves from data hazards (all audit tasks are read-only → wave 1 all parallel, wave 2 depends on wave 1 outputs, wave 3 depends on wave 2) |
| `AuditPlan.stats.estimatedTokens` | `Budget` schema on each task | Varp already has token + minute budgets per task |
| File discovery | Manifest paths + `discoverDocs()` | Component boundaries already defined |

## Varp Enhances (use but don't reimplement)

| Capability | Varp Module | Audit Use |
|---|---|---|
| `invalidationCascade()` | `manifest/graph.ts` | Given a finding in component A, which downstream components are affected? |
| `computeCriticalPath()` | `scheduler/critical-path.ts` | Budget-constrained audits: which components to scan first |
| `scanImports()` | `manifest/imports.ts` | Better rule-to-file matching via actual dependency graph instead of filename heuristics |
| `resolveDocs()` | `manifest/resolver.ts` | Load component docs as additional audit context |
| Component tags | Manifest `tags` field | Match rule "applies to" against component tags instead of filename patterns |
| `validatePlan()` | `plan/validator.ts` | Validate generated audit plans against manifest |

## Audit-Specific (keep)

| Module | Why It's New |
|---|---|
| `ruleset-parser.ts` | Compliance rulesets are a new domain concept. Varp has no equivalent. |
| Rule-to-component matching | Maps compliance rules to code components. Currently filename heuristics, will use manifest tags post-merge. |
| `Finding` type | Compliance findings (severity, evidence, remediation, rule reference). Varp's output is task success/failure, not findings. |
| Audit report synthesis | Deduplication, confidence scoring from redundant passes, coverage gaps. Different from varp's plan diffing. |

## Integration Architecture (Post-Merge)

```
Audit Planner
  INPUT:  varp manifest + ruleset(s) + scope
  OUTPUT: varp plan XML with audit-specific metadata

  1. Parse ruleset → Rule[]
  2. For each manifest component:
     - Match rules to component (via tags, not filename heuristics)
     - Generate task with touches={reads: [component]}, budget, description
  3. Add cross-cutting tasks (reads multiple components)
  4. Add synthesis task (depends on all others)
  5. Emit plan XML → varp validates, schedules, executes
```

The planner becomes a **ruleset → varp plan** translator. Varp handles scheduling, execution, enforcement.

## Key Varp Types (for reference)

```typescript
// Manifest component
interface Component {
  path: string | string[];
  deps?: string[];
  docs?: string[];
  tags?: string[];
  test?: string;
  env?: string[];
  stability?: 'stable' | 'active' | 'experimental';
}

// Plan task
interface Task {
  id: string;
  description: string;
  action: 'implement' | 'test' | 'document' | 'refactor' | 'migrate';
  values?: string[];
  touches: { reads?: string[]; writes?: string[] };
  budget: { tokens: number; minutes: number };
}

// Scheduler output
interface Wave {
  id: number;
  tasks: Task[];
}
```

## Varp Codebase Location

`/Users/nori/Projects/agent-toolkit/varp/`

Key files:
- `src/shared/types.ts` — Zod schemas (source of truth for all types)
- `src/shared/ownership.ts` — file → component lookup
- `src/manifest/parser.ts` — YAML manifest parsing
- `src/scheduler/waves.ts` — wave computation
- `src/plan/parser.ts` — XML plan parsing
- `src/plan/validator.ts` — plan validation
