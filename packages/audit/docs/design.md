# Varp Audit — Design Document

**Status:** Draft v3
**Date:** February 2026

> **Note:** For current implementation state vs. this design, see [implementation-status.md](implementation-status.md).

## Problem

Existing AI code review tools (CodeRabbit, Qodo, Greptile) are optimized for incremental PR review — they analyze diffs, not codebases. Existing compliance platforms (Vanta, Drata, Secureframe) verify organizational controls (is MFA enabled? are policies documented?) but don't analyze code behavior.

Neither answers the question: **does this codebase actually comply with a given standard?**

Examples of questions that require full-codebase, code-level compliance analysis:

- Is PII being logged or leaked into error messages?
- Does the code actually implement the data deletion the privacy policy promises?
- Are consent flags checked before data processing?
- Is encryption applied consistently to data at rest?
- Do authentication checks cover all API entry points?

These require tracing data flows, understanding architectural patterns, and checking behavior across module boundaries — not just scanning a diff.

## Core Value Proposition

**Varp Audit** provides reliable compliance analysis that scales from small projects to large monorepos without the user changing their workflow.

The user's mental model is simple: **point it at a codebase, tell it what you care about, get a report.** The system handles everything else — how the codebase is analyzed, how many passes are needed, which models are used, and how findings are aggregated. The user cares about the quality and actionability of the report, not the machinery behind it.

**What makes this different:**

1. **Code-level compliance, not organizational controls** — analyzes what the code actually does against specific standards, not whether your org has the right policies on paper.
2. **Full codebase scope** — traces data flows and architectural patterns across the entire repository, not just individual changes.
3. **Framework-aware** — structured checking against specific standards (OWASP, HIPAA, PCI-DSS, GDPR, custom organizational rules), not generic bug detection.
4. **Scales transparently** — a 5,000-line project and a 500,000-line monorepo get the same interface and the same report format. The system adapts its strategy internally.
5. **Audit-over-time** — tracks compliance drift by diffing findings against previous audit runs, turning point-in-time snapshots into continuous compliance visibility.

## User Experience

### Interface

The primary interface is a CLI (`varp-audit`). The surface is intentionally minimal:

```
varp-audit audit ./src --ruleset owasp-top-10
```

The system discovers files, parses the ruleset, generates a plan, executes it, and produces a report.

Implemented flags:

- `--ruleset <name>` — which compliance framework to check against (default: `owasp-top-10`). Accepts built-in names, file paths, or relative paths.
- `--model <name>` — Claude model (default: `claude-sonnet-4-5-20250929`)
- `--concurrency <n>` — max parallel API calls per wave (default: 5)
- `--format <type>` — output format: `text`, `json`, `markdown` (default: `text`)
- `--output <path>` — write report to file
- `--diff [ref]` — incremental audit — only changed files (default ref: `HEAD`)
- `--budget <tokens>` — max estimated tokens; skips low-priority tasks when exceeded
- `--baseline <path>` — compare against a previous report JSON for drift tracking
- `--quiet` — suppress progress output

GitHub Actions integration exists (`cli/github/`) for PR comment posting. Dashboard sync (`cli/dashboard-sync.ts`) sends generic review results to a web dashboard via API key auth.

### Report

Every audit produces a structured report. The format is consistent regardless of how the analysis was executed internally. A finding from a quick scan looks identical to a finding from a deep audit.

Each finding includes:

- **Rule reference** — which compliance rule this relates to
- **Severity** — critical, high, medium, low, informational
- **Location** — file path(s) and line range(s)
- **Evidence** — the specific code pattern or behavior observed
- **Explanation** — why this is a compliance concern
- **Remediation** — suggested fix or approach
- **Confidence** — how certain the system is (single-pass findings vs. multi-agent corroborated findings)

Report-level metadata:

- **Summary** — overall compliance posture, coverage statistics
- **Coverage** — what was checked, what wasn't, and why
- **Diff** (if applicable) — new, resolved, and regressed findings since last audit
- **Cost and performance** — tokens used, time elapsed, models used

The report is structured data (JSON/YAML) that can be rendered into human-readable formats (markdown, HTML, PDF). The specific schema will evolve through use.

## Architecture

### Composition with Varp Core

Varp Audit depends on `@vevx/varp/lib` for manifest types, chunking utilities, and concurrency primitives (`runWithConcurrency`). It imports `ModelCaller` and `ModelCallerResult` types from core. However, audit owns its own execution pipeline — a 3-wave planner/executor that runs directly, not via Core's strategy layer.

```
┌──────────────────────────────────────────────────┐
│                   Varp Audit                      │
│                                                   │
│  CLI (varp-audit)   Rulesets        Reporters      │
│  (audit, login,     (OWASP, etc.)  (terminal,     │
│   logout, --diff,                   markdown,      │
│   --baseline)                       JSON, drift)   │
│       │                │              ▲            │
│       └── plan ────────┘              │            │
│            │                       findings        │
│            ▼                          │            │
│  Planner → Executor (3-wave) → Synthesis           │
│  (component grouping,  (concurrent    (dedup,      │
│   rule matching,        API calls,    coverage,    │
│   manifest-aware)       budget ctrl)  suppress)    │
│                                                    │
│  Generic Review (separate path):                   │
│  files → orchestrator → weighted agents → report   │
├──────────────────────────────────────────────────┤
│                  @vevx/varp/lib                    │
│                                                   │
│  Manifest types, componentPaths, estimateTokens,  │
│  createChunks, runWithConcurrency,                │
│  ModelCaller/ModelCallerResult                     │
└──────────────────────────────────────────────────┘
```

### What Varp Audit Owns

Varp Audit is responsible for:

**Two execution modes:**

1. **Generic review** — `runAudit()` runs 7 weighted agents (correctness, security, performance, maintainability, edge-cases, accessibility, documentation) in parallel, producing scored findings with a weighted-average overall score.
2. **Compliance audit** — `executeAuditPlan()` runs a 3-wave plan against a parsed ruleset, producing a structured compliance report with coverage tracking and corroboration.

**Rulesets** — compliance framework definitions in markdown with YAML frontmatter. Each ruleset defines rules with IDs, descriptions, compliant/violating patterns, severity, appliesTo tags, and cross-cutting patterns.

**Planner** — translates (files + ruleset + optional manifest) into a 3-wave audit plan. Uses manifest components and tag-based rule matching when available, falls back to directory-based heuristic grouping.

**Executor** — runs audit plan waves with configurable concurrency, budget enforcement (token-based), and structured JSON schema output (constrained decoding).

**Synthesis** — deduplicates findings across tasks via `findingsOverlap()` (same ruleId + overlapping file/line range), computes corroboration confidence, applies suppressions, computes coverage.

**Reporters** — terminal (ANSI), markdown, and JSON output for both compliance reports and drift reports.

**CLI** — `varp-audit` binary with `audit`, `login`, `logout` subcommands. Calls Claude via the Claude Code CLI (`claude -p`), not the Anthropic API directly.

**Backend abstraction** — `ModelCaller` interface (imported from `@vevx/varp/lib`) lets consumers inject any LLM backend. The CLI injects a Claude Code CLI caller; tests can inject mocks.

### Manifest Handling

The planner uses the manifest for component boundaries and tag-based rule matching when available. Two scenarios:

- **Manifest exists** — `loadManifestComponents()` reads `varp.yaml`, uses `componentPaths()` from core to resolve component paths, and `assignFilesToComponents()` to map discovered files to components. `matchRulesByTags()` uses component tags for rule matching (substring matching between component tags and rule `appliesTo` tags).
- **No manifest** — `groupIntoComponents()` groups files by top-level directory structure (first two directory levels as component key). File-to-rule matching falls back to `TAG_PATTERNS` — regex-based heuristics mapping rule tags like "API routes" to filename patterns like `/route/i`, `/handler/i`.

The manifest is discovered automatically by walking up from the target path. An explicit `--manifest` path can also be provided.

## Execution Pipeline

### Plan Generation (`generatePlan()`)

1. **Load components** — from manifest (tag-aware) or heuristic directory grouping
2. **Match rules to components** — tag-based matching with manifest, filename-pattern heuristics without
3. **Generate component scan tasks** — one per (component, rule category) pair. Rules grouped by category within each component. Files filtered to those matching the category's rules.
4. **Generate cross-cutting tasks** — one per `CrossCuttingPattern` in the ruleset, operating on all files
5. **Generate synthesis task** — placeholder for in-process aggregation

### Execution (`executeAuditPlan()`)

```
Wave 1: Component scan tasks (parallel, concurrency-limited)
Wave 2: Cross-cutting tasks (parallel, concurrency-limited)
Wave 3: Synthesis (in-process, no API call)
```

Each task in waves 1-2: generate prompt (`generatePrompt()`) with rules/code context, call `ModelCaller` with JSON schema for constrained decoding (`AUDIT_FINDINGS_SCHEMA`), parse response into `AuditTaskResult`.

Concurrency is controlled via `runWithConcurrency()` from `@vevx/varp/lib` (default: 5 concurrent API calls per wave).

Risk-priority ordering within waves ensures critical-severity rules are scanned first. Budget enforcement (`--budget`) tracks cumulative estimated tokens and skips low-priority tasks when exceeded.

### Synthesis

Wave 3 runs in-process (no API call):

1. `deduplicateFindings()` — groups overlapping findings (same ruleId + overlapping file/line range), picks canonical finding by severity then confidence, computes corroboration count and effective confidence
2. `applySuppressions()` — applies config-file and inline suppressions
3. `computeCoverage()` — tracks which (component, rule) pairs were checked
4. Assembles `ComplianceReport` with scope, findings, summary, coverage, and metadata

### Error Handling

Failed tasks are logged and tracked in coverage as "agent failed". The report shows which components were not fully audited. `Promise.allSettled` in the generic review path and `runWithConcurrency`'s `onError` callback in the compliance path ensure individual task failures don't abort the audit.

## Rulesets

Rulesets are markdown documents that encode compliance requirements in a form that LLM agents can interpret and apply. They are not formal rule engines — the LLM's interpretation is the engine.

A ruleset contains:

- **Framework metadata** — name, version, scope, applicability
- **Rules** — each with an identifier, description, compliant patterns, violation patterns, severity, and applicable component types
- **Guidance** — contextual notes on interpretation, common false positives, edge cases

Example (abbreviated):

```markdown
# OWASP Top 10 — Injection (A03:2021)

## Rule: SQL-INJ-01 — Parameterized Queries

**Severity:** Critical
**Applies to:** Components tagged `database`, `api`, `backend`

**Compliant:** All SQL queries use parameterized queries or prepared statements.
**Violation:** String concatenation or template literals used to build SQL queries
with user input.

**Guidance:** ORMs generally handle parameterization, but check for raw query
escape hatches (e.g., `sequelize.query()`, `prisma.$queryRawUnsafe()`).
```

Starting with hand-written rulesets for OWASP Top 10 is the pragmatic first step. Domain-specific frameworks (HIPAA, PCI-DSS, GDPR) can be added as rulesets without changing any machinery.

Custom organizational rulesets (coding standards, architectural rules, security policies) are a natural extension and a strong enterprise selling point.

## Model Strategy

Model selection is configurable via `--model` flag (default: `claude-sonnet-4-5-20250929`). All tasks in a single audit run use the same model. Synthesis is done in-process (no model call).

## Non-Functional Requirements

**Consistency** — `ComplianceReport` schema is identical regardless of codebase size. Finding schema (`AuditFinding`) includes ruleId, severity (5-level: critical/high/medium/low/informational), locations, evidence, remediation, and confidence.

**Confidence and corroboration** — LLM outputs vary between runs. Each finding carries a self-assessed confidence (0.0-1.0). When multiple tasks flag the same issue (same ruleId + overlapping locations), effective confidence increases: `min(1.0, base + 0.1 * (corroborations - 1))`.

**Cost management** — `--budget` sets a token ceiling. Tasks are priority-ordered (critical-severity first). When cumulative estimated tokens exceed the budget, remaining tasks are skipped. Coverage report shows what was and wasn't checked.

**Traceability** — every finding traces to specific code locations (file + line range) and specific rule IDs. Parse errors produce an informational finding with `PARSE-ERROR` ruleId.

## Package Structure

```
packages/audit/
  src/
    index.ts              — barrel export (agents, orchestrator, chunker, report, discovery, errors, planner)
    cli.ts                — CLI entry point (varp-audit binary)
    orchestrator.ts       — Generic review: run weighted agents in parallel
    discovery.ts          — File discovery (Bun.Glob, gitignore-aware)
    chunker.ts            — Re-exports chunking utilities from @vevx/varp/lib
    errors.ts             — Domain errors (RateLimitError, AuthenticationError, ValidationError, AgentError)
    agents/
      index.ts            — 7 weighted agents (correctness 22%, security 22%, performance 13%, ...)
      types.ts            — FileContent, Finding, AgentResult, AgentDefinition
      factory.ts          — createAgent(), parseAgentResponse() — agent construction helpers
      *.ts                — Individual agent definitions
    planner/
      index.ts            — Barrel export for compliance audit pipeline
      types.ts            — Ruleset, Rule, CrossCuttingPattern, AuditComponent, AuditTask, AuditPlan
      planner.ts          — generatePlan(), groupIntoComponents()
      executor.ts         — executeAuditPlan() — 3-wave execution with concurrency + budget
      ruleset-parser.ts   — parseRuleset() — YAML frontmatter + markdown rule parser
      findings.ts         — AuditFinding, CorroboratedFinding, ComplianceReport, deduplicateFindings()
      prompt-generator.ts — Prompt generation + AUDIT_FINDINGS_SCHEMA + response parsing
      suppressions.ts     — Config-file + inline suppression matching
      diff-filter.ts      — Incremental audit: git diff + dependency-graph expansion
      drift.ts            — diffReports() — compare two compliance reports
      manifest-adapter.ts — Manifest discovery, parsing, component-to-file assignment
      compliance-reporter.ts — Terminal, markdown, JSON output for ComplianceReport
    report/
      index.ts            — Barrel export for generic review reporters
      synthesizer.ts      — synthesizeReport() — weighted-average scoring for generic review
      terminal.ts         — ANSI terminal output for generic review
      markdown.ts         — Markdown output for generic review
    cli/
      audit.ts            — runAuditCommand() — full audit flow (discovery, plan, execute, output)
      claude-client.ts    — ModelCaller implementation via Claude Code CLI (claude -p)
      auth.ts             — login/logout — dashboard API key management
      dashboard-sync.ts   — syncToDashboard() — send generic review results to dashboard
      formatters/         — HTML, JSON, markdown formatters for generic review
      github/             — GitHub Actions integration (PR comments, changed files)
  rulesets/               — Built-in rulesets (owasp-top-10.md)
```

## Open Questions

- **Integration points** — CLI done. GitHub Actions integration exists (PR comments) but needs testing. IDE integration and dashboard/reporting platform are future considerations.
- **Multi-repo** — enterprise codebases span multiple repositories. Cross-repo orchestration needs design.
- **Regulatory certification** — can Varp Audit's reports be used as evidence in actual compliance audits (SOC 2, etc.)?
- **Generic review vs compliance consolidation** — the two execution paths (orchestrator + weighted agents vs planner + 3-wave executor) share no code. Consider whether the generic review path should be retired or unified with the compliance pipeline.

## Resolved Questions

- **Ruleset authoring** — YAML frontmatter + markdown body. See `rulesets/owasp-top-10.md` for the format.
- **Self-audit** — works. See `docs/examples/self-audit-report.md` for a report of the tool auditing itself against OWASP Top 10.
- **False positive handling** — Two suppression sources: inline comments (`// audit-suppress RULE-ID "reason"`) and config file (`.audit-suppress.yaml` with rule/file/glob matchers). Config takes precedence. Suppressed findings are excluded from the report; suppressed count shown in metadata. See `suppressions.ts`.
- **Incremental audits** — `--diff [ref]` flag runs `git diff --name-only` and filters discovered files to only those changed. When a manifest is available, `expandWithDependents()` uses the dependency graph to include files in downstream components (invalidation cascade). Report shows "incremental" scope with diff ref. See `diff-filter.ts`.
