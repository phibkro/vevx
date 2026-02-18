# Audit

Multi-agent code audit engine. Two modes: generic quality review (weighted agents) and ruleset-based compliance auditing (3-wave planner).

Depends on `@varp/core/lib` for manifest types (`Manifest`, `Component`, `componentPaths`). Backend-agnostic — consumers inject a `ModelCaller` implementation.

## Architecture

```
Generic review:     files → orchestrator → weighted agents → scored report
Compliance audit:   files + ruleset → planner → 3-wave executor → compliance report
                                                      ↓
                                                ModelCaller (injected)
```

## Modules

| Module | Purpose |
|--------|---------|
| `orchestrator.ts` | Generic review — runs weighted agents in parallel, scores results |
| `chunker.ts` | Splits source files into token-bounded chunks |
| `discovery.ts` | File discovery (Bun runtime) |
| `discovery-node.ts` | File discovery (Node.js runtime) |
| `errors.ts` | Domain error types |
| `agents/` | Specialized review agents with weights (see `agents/README.md`) |
| `planner/` | Compliance audit pipeline (see `planner/README.md`) |

## Generic Review

`runAudit(files, options, onProgress?)` runs all weighted agents in parallel against the provided files. Each agent produces findings with severity levels and a score. Results are combined into a weighted average. Used by the CLI's default review mode.

## Compliance Audit

`executeAuditPlan(plan, files, ruleset, options)` runs a 3-wave audit plan:

1. `parseRuleset()` — parse markdown ruleset into structured rules
2. `generatePlan()` — create plan with manifest-aware component grouping
3. `executeAuditPlan()` — execute waves via `ModelCaller`, with optional token budget enforcement (`--budget`)
4. `printComplianceReport()` / `generateComplianceMarkdown()` / `generateComplianceJson()` — render results

Features: suppressions (`// audit-suppress`), incremental audits (`--diff`), token budgeting (`--budget`), structured output via JSON schema. See `planner/README.md` for details.
