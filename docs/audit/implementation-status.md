# Audit Implementation Status

Current state of Varp Audit relative to the [design document](design.md). Updated February 2026.

## What's Built

Two audit modes, a CLI, and one ruleset.

| Layer | Details |
|-------|---------|
| Compliance audit | 3-wave planner, executor, prompt generator, findings schema, reporter |
| Generic review | 7 weighted agents, parallel orchestrator, report synthesizer |
| CLI | `varp audit` with ruleset, diff, budget, format, concurrency flags |
| Suppressions | Inline (`// audit-suppress`) + config file (`.audit-suppress.yaml`) |
| Incremental | `--diff [ref]` with manifest-aware invalidation cascade |
| Rulesets | OWASP Top 10 |
| Tests | 10 test files covering parser, planner, executor, findings, suppressions, diff-filter, manifest-adapter, reporter, orchestrator, chunker |

### Compliance Audit Pipeline

| Module | Exports | Status |
|--------|---------|--------|
| `planner/types.ts` | `Rule`, `Ruleset`, `AuditTask`, `AuditPlan`, `ModelCaller` | Complete |
| `planner/ruleset-parser.ts` | `parseRuleset()` | Complete |
| `planner/planner.ts` | `generatePlan()` | Complete — manifest-aware with heuristic fallback |
| `planner/executor.ts` | `executeAuditPlan()` | Complete — bounded concurrency, budget enforcement, progress callbacks |
| `planner/findings.ts` | `AuditFinding`, `deduplicateFindings()`, `ComplianceReport` | Complete — corroboration boosting, coverage tracking |
| `planner/prompt-generator.ts` | `generatePrompt()`, `parseAuditResponse()`, `AUDIT_FINDINGS_SCHEMA` | Complete — structured output + text fallback |
| `planner/suppressions.ts` | `applySuppressions()` | Complete — inline + config file |
| `planner/diff-filter.ts` | `getChangedFiles()`, `expandWithDependents()` | Complete — git diff + manifest cascade |
| `planner/manifest-adapter.ts` | `loadManifestComponents()`, `matchRulesByTags()` | Complete — uses `@varp/core/lib` types |
| `planner/compliance-reporter.ts` | `printComplianceReport()`, `generateComplianceMarkdown()`, `generateComplianceJson()` | Complete — terminal, markdown, JSON |

### Generic Review Pipeline

| Module | Exports | Status |
|--------|---------|--------|
| `orchestrator.ts` | `runAudit()` | Complete — parallel agents, weighted scoring |
| `agents/` | 7 agents (correctness, security, performance, maintainability, edge-cases, accessibility, documentation) | Complete — weights sum to 1.0 |
| `chunker.ts` | `createChunks()` | Complete — token-based bin packing |
| `report/synthesizer.ts` | `synthesizeReport()` | Complete — aggregation + scoring |
| `discovery.ts` | `discoverFiles()` | Complete — gitignore-aware, language detection |

### CLI

| Flag | Purpose | Status |
|------|---------|--------|
| `--ruleset <name>` | Compliance framework | Complete (default: owasp-top-10) |
| `--model <name>` | LLM model | Complete (default: claude-sonnet-4-5-20250929) |
| `--concurrency <n>` | Parallel tasks per wave | Complete (default: 5) |
| `--format text\|json\|markdown` | Output format | Complete (default: text) |
| `--output <path>` | Write report to file | Complete |
| `--quiet` | Suppress progress output | Complete |
| `--diff [ref]` | Incremental audit | Complete (default ref: HEAD) |
| `--budget <tokens>` | Max token spend | Complete — skips low-priority tasks when exhausted |
| `--baseline <path>` | Drift comparison | Not implemented (library-side partially done) |
| `--quick` / `--thorough` | Coverage bias | Not implemented |
| `--scope <path>` | Audit subset | Not implemented (positional path arg serves same purpose) |

## Changes from Design Doc

### Implemented Differently

**No Core strategy layer.** The design doc envisions Core owning the "single-pass vs orchestrated" decision. In practice, Audit owns its own 3-wave execution directly — it calls `ModelCaller` itself rather than submitting a goal to Core. Core provides manifest types and graph utilities but not execution strategy.

**Budget is a CLI flag, not dropped.** The design doc (updated per ADR-001) says budget was dropped in favor of observability metrics. The implementation still has `--budget <tokens>` which enforces a token ceiling by skipping low-priority tasks. This is useful and should stay.

**No model strategy layer.** The design doc describes per-role model selection (Opus for synthesis, Sonnet for scanning, Haiku for CI). The implementation uses a single `--model` flag for all tasks. Model selection is the user's decision, not automated.

**No redundancy/corroboration passes.** The design doc describes `--thorough` scheduling redundant agents for multi-agent corroboration. The implementation has corroboration boosting (confidence increases when findings overlap across tasks), but no redundant scheduling — corroboration only happens when independent tasks flag the same issue.

### Not Implemented

| Design Feature | Status | Notes |
|----------------|--------|-------|
| Core strategy layer (goal submission) | Not implemented | Audit executes directly; no strategy/routing in Core |
| `--quick` / `--thorough` flags | Not implemented | Single execution mode |
| `--scope <path>` flag | Not needed | Positional `<path>` argument |
| Redundant agent passes | Not implemented | No `--thorough` mode |
| CI integration (GitHub Action) | Not implemented | CLI only |
| Auto-manifest generation for unknown codebases | Not implemented | Requires manifest or falls back to heuristics |
| HIPAA/PCI-DSS/GDPR rulesets | Not implemented | OWASP Top 10 only |
| Custom organizational rulesets | Not implemented | Framework supports it; no examples/docs |
| Drift tracking (`diffReports()`) | Missing from varp | Was implemented in old standalone repo (`code-review/packages/core/src/planner/drift.ts`) but not migrated |
| `--baseline` CLI flag | Not implemented | Depends on drift tracking migration |

### Stale Documentation

| File | Issue |
|------|-------|
| `packages/audit/README.md` | References `discovery-node.ts` — file doesn't exist |
| `packages/audit/TODO.md` | Lists drift tracking as "Done" — code wasn't migrated to varp |
| `packages/audit/src/planner/README.md` | Documents `diffReports()`, `printDriftReport()`, `generateDriftMarkdown()`, `generateDriftJson()` — none exist in source |

## Architecture

See the [design document](design.md) for the full vision. See `packages/audit/README.md` for module layout and `packages/audit/src/planner/README.md` for the compliance pipeline details.
