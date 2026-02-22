# Audit

Multi-agent code audit engine. Two modes: generic quality review (weighted agents) and ruleset-based compliance auditing (3-wave planner/executor).

Depends on `@varp/core/lib` for manifest types, chunking, and concurrency primitives. Backend-agnostic -- consumers inject a `ModelCaller` implementation.

## Architecture

```
Generic review:     files -> orchestrator -> 7 weighted agents -> scored report
Compliance audit:   files + ruleset -> planner -> 3-wave executor -> compliance report
                                                      |
                                                ModelCaller (injected)
```

## Modules

| Module | Purpose |
|--------|---------|
| `orchestrator.ts` | Generic review -- runs weighted agents in parallel, produces scored results |
| `chunker.ts` | Re-exports chunking utilities from `@varp/core/lib` |
| `discovery.ts` | File discovery via `Bun.Glob`, gitignore-aware, binary detection |
| `errors.ts` | Domain errors: `RateLimitError`, `AuthenticationError`, `ValidationError`, `AgentError` |
| `agents/` | 7 weighted review agents (see below) |
| `planner/` | Compliance audit pipeline (see below) |
| `report/` | Generic review reporters: terminal, markdown, synthesizer |
| `cli/` | CLI implementation: audit command, Claude client, auth, dashboard sync, formatters, GitHub integration |

## Generic Review

`runAudit(files, options, onProgress?)` runs all weighted agents in parallel against the provided files. Each agent produces findings with severity levels and a score (0-10). Results are combined into a weighted average.

Agents (7 active, weights sum to 1.0):
- Correctness (0.22), Security (0.22), Maintainability (0.15), Performance (0.13), Edge Cases (0.13), Accessibility (0.10), Documentation (0.05)
- Dependency Security agent exists but is disabled by default (weight 0.00)

Agents are built via `createAgent()` factory in `agents/factory.ts`, which handles prompt generation and JSON response parsing.

Report types: `AuditReport` (synthesizer), terminal output (`printReport`), markdown (`generateMarkdown`).

## Compliance Audit

`executeAuditPlan(plan, files, ruleset, options)` runs a 3-wave audit plan:

1. `parseRuleset()` -- parse markdown ruleset (YAML frontmatter + `##` categories + `###` rules) into structured `Ruleset`
2. `generatePlan()` -- create plan with manifest-aware component grouping and tag-based rule matching (falls back to directory heuristics)
3. `executeAuditPlan()` -- execute waves via `ModelCaller` with JSON schema constrained decoding (`AUDIT_FINDINGS_SCHEMA`), concurrency control (`runWithConcurrency`, default 5), and optional token budget enforcement (`--budget`)
4. Wave 3 synthesis: in-process deduplication (`deduplicateFindings`), suppression application, coverage computation
5. `printComplianceReport()` / `generateComplianceMarkdown()` / `generateComplianceJson()` -- render results

Features:
- **Suppressions** -- inline (`// audit-suppress RULE-ID "reason"`) and config file (`.audit-suppress.yaml` with rule/file/glob matchers). Config rules checked first. Suppressed findings excluded from report; count shown in metadata.
- **Incremental audits** -- `--diff [ref]` runs `git diff --name-only`, filters discovered files. `expandWithDependents()` uses the manifest dependency graph to include downstream component files.
- **Budget enforcement** -- `--budget <tokens>` skips low-priority tasks when cumulative estimated tokens exceed the limit. Tasks are priority-ordered by severity.
- **Drift tracking** -- `diffReports(baseline, current)` compares two compliance reports. Finds new, resolved, and changed findings using `findingsOverlap()`. Renderers: `printDriftReport()`, `generateDriftMarkdown()`, `generateDriftJson()`.
- **Structured output** -- `AUDIT_FINDINGS_SCHEMA` enables constrained JSON decoding when the model backend supports it.
- **Corroboration** -- findings flagged by multiple tasks get boosted confidence: `min(1.0, base + 0.1 * (corroborations - 1))`.

## CLI

Binary: `varp-audit`. Entry point: `src/cli.ts`.

```
varp-audit audit <path>        # Full compliance audit (default ruleset: owasp-top-10)
varp-audit audit <path> --diff # Incremental audit (changed files only)
varp-audit audit <path> --format json --output report.json
varp-audit audit <path> --baseline prev.json  # Drift comparison
varp-audit audit <path> --budget 500000       # Token budget
varp-audit login               # Save dashboard API key
varp-audit logout              # Remove saved API key
```

The CLI calls Claude via the Claude Code CLI (`claude -p`) through `claude-client.ts`, which implements the `ModelCaller` interface. This avoids direct Anthropic API dependency -- authentication is handled by Claude Code.

## Key Types

| Type | Location | Purpose |
|------|----------|---------|
| `ModelCaller` | `@varp/core/lib` | `(system, user, options) -> { text, structured?, usage? }` |
| `AuditFinding` | `planner/findings.ts` | Single compliance finding with ruleId, severity, locations, evidence, confidence |
| `CorroboratedFinding` | `planner/findings.ts` | Deduplicated finding with corroboration count and effective confidence |
| `ComplianceReport` | `planner/findings.ts` | Full report: scope, findings, summary, coverage, metadata |
| `AuditPlan` | `planner/types.ts` | 3-wave plan: components, wave1/wave2/wave3 tasks, stats |
| `Ruleset` | `planner/types.ts` | Parsed ruleset: meta, rules, crossCutting patterns |
| `AgentResult` | `agents/types.ts` | Generic review agent output: score, findings, summary |
| `AuditReport` | `report/synthesizer.ts` | Generic review report: weighted score, finding counts |
| `DriftReport` | `planner/drift.ts` | Comparison of two compliance reports: new, resolved, changed |
