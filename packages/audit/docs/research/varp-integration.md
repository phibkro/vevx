# Varp Integration Notes

How varp's existing capabilities map to audit needs. The repos have merged — audit lives at `packages/audit/`. These notes track what's been integrated and what remains.

## Integrated

| Audit Code                           | Varp Feature                                  | Status                                                                                                                                                                                                   |
| ------------------------------------ | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `groupIntoComponents()`              | Manifest components via `manifest-adapter.ts` | **Done.** `generatePlan()` uses manifest components when `varp.yaml` exists, falls back to heuristic grouping. Standalone YAML parser (not importing from `@vevx/varp` since it uses Bun-specific APIs). |
| `TAG_PATTERNS` + `fileMatchesRule()` | Tag-based matching via `matchRulesByTags()`   | **Done.** Component tags from manifest replace filename pattern heuristics.                                                                                                                              |
| `invalidationCascade()`              | `diff-filter.ts` `expandWithDependents()`     | **Done.** Used for `--diff` incremental audits — reverse-dependency BFS from changed components.                                                                                                         |

## Not Yet Integrated

| Audit Code                        | Varp Replacement                  | Notes                                                                                                                                   |
| --------------------------------- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Hardcoded 3-wave structure        | `computeWaves()` from scheduler   | All audit tasks are read-only → current 3-wave structure is correct. Full scheduler adds value only if audit gains write-capable tasks. |
| File discovery                    | Manifest paths + `discoverDocs()` | Component boundaries available but discovery still uses standalone module                                                               |
| `AuditPlan.stats.estimatedTokens` | Execution metrics in `log.xml`    | Budget enforcement dropped per ADR-001; token usage is observability only                                                               |

## Varp Enhances (use but don't reimplement)

| Capability              | Varp Module                  | Audit Use                                                                               |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| `invalidationCascade()` | `manifest/graph.ts`          | Given a finding in component A, which downstream components are affected?               |
| `computeCriticalPath()` | `scheduler/critical-path.ts` | Prioritize scanning: which component chains to scan first                               |
| `scanImports()`         | `manifest/imports.ts`        | Better rule-to-file matching via actual dependency graph instead of filename heuristics |
| `resolveDocs()`         | `manifest/resolver.ts`       | Load component docs as additional audit context                                         |
| Component tags          | Manifest `tags` field        | Match rule "applies to" against component tags instead of filename patterns             |
| `validatePlan()`        | `plan/validator.ts`          | Validate generated audit plans against manifest                                         |

## Audit-Specific (keep)

| Module                     | Why It's New                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ruleset-parser.ts`        | Compliance rulesets are a new domain concept. Varp has no equivalent.                                                       |
| Rule-to-component matching | Maps compliance rules to code components. Currently filename heuristics, will use manifest tags post-merge.                 |
| `Finding` type             | Compliance findings (severity, evidence, remediation, rule reference). Varp's output is task success/failure, not findings. |
| Audit report synthesis     | Deduplication, confidence scoring from redundant passes, coverage gaps. Different from varp's plan diffing.                 |

## Integration Architecture (Post-Merge)

```
Audit Planner
  INPUT:  varp manifest + ruleset(s) + scope
  OUTPUT: varp plan XML with audit-specific metadata

  1. Parse ruleset → Rule[]
  2. For each manifest component:
     - Match rules to component (via tags, not filename heuristics)
     - Generate task with touches={reads: [component]}, description
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
  stability?: "stable" | "active" | "experimental";
}

// Plan task
interface Task {
  id: string;
  description: string;
  action: "implement" | "test" | "document" | "refactor" | "migrate";
  values?: string[];
  touches: { reads?: string[]; writes?: string[] };
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
