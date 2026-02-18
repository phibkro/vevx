# Varp Audit — Design Document

**Status:** Draft v3
**Date:** February 2026

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

The primary interface is a CLI. The surface is intentionally minimal:

```
varp audit --ruleset owasp ./src
```

The system reads the codebase, selects the appropriate analysis strategy, runs the audit, and produces a report. No configuration of agents, models, context windows, or parallelism.

Optional flags for user intent, not implementation details:

- `--quick` / `--thorough` — bias toward speed or coverage (can also be inferred automatically from codebase size and budget)
- `--ruleset <name>` — which compliance framework(s) to check against
- `--scope <path>` — audit a subset of the codebase
- `--diff` — compare against the previous audit run
- ~~`--budget <amount>`~~ — dropped per ADR-001; token usage tracked as observability metrics

CI integration is the second target: run as a GitHub Action or similar, with findings surfaced as PR annotations or status checks.

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

Varp Audit does not implement its own execution strategy. It composes with Varp Core, which owns the decision of *how* a goal gets executed.

Varp Core's abstraction: **given a goal and a codebase, produce a result.** Core reads the manifest (or infers codebase structure), estimates complexity, and selects the appropriate execution strategy:

- **Simple / small scope** → single-pass execution. One agent, one context window, no planning or scheduling overhead.
- **Complex / large scope** → orchestrated execution. Plan decomposition, wave scheduling, multi-agent dispatch, supervision, synthesis.

This decision lives in Core, not in any domain package. All packages — audit, migration, documentation, test generation — submit goals with domain-specific context and receive results in a consistent format. They don't decide how execution happens.

```
┌──────────────────────────────────────────────────┐
│                   Varp Audit                      │
│                                                   │
│  CLI / MCP        Rulesets        Reporter         │
│  (user             (compliance     (synthesis,     │
│   interface)        frameworks)    diffing)        │
│       │                │              ▲            │
│       └───── goal ─────┘              │            │
│                │                   findings        │
│                ▼                      │            │
├──────────────────────────────────────────────────┤
│                   Varp Core                       │
│                                                   │
│  Manifest ─── Strategy ─── Execution              │
│  (codebase     (single-pass   (plan, schedule,    │
│   structure)    or orchestrate) dispatch, supervise)│
│                                                   │
│  The strategy layer selects execution mode:       │
│  • Small codebase / simple goal → single pass     │
│  • Large codebase / complex goal → orchestrate    │
│  • Budget constrained → optimize coverage         │
│                                                   │
│  Output format is identical regardless of mode.   │
└──────────────────────────────────────────────────┘
```

This means:

- Audit doesn't implement single-pass vs orchestrated logic — Core does
- A future `varp migrate` or `varp document` package gets the same scaling behavior for free
- Strategy tuning (threshold calibration, model selection, budget optimization) improves all packages at once
- The execution mode is an internal detail that no consumer ever reasons about

### What Varp Audit Owns

Varp Audit is responsible for the domain-specific layer:

**Rulesets** — compliance framework definitions, expressed as structured markdown documents. Each ruleset defines rules with descriptions, compliant/violating patterns, severity, and applicability. Rulesets are the domain knowledge layer.

**Goal construction** — translating user input (ruleset + scope + flags) into a goal that Core can execute. For orchestrated mode, this includes providing the decomposition strategy: how to partition work across components and rules, which tasks are cross-cutting, how to handle redundancy.

**Reporter** — aggregating findings from Core's execution output, deduplicating, ranking by severity, calculating coverage statistics, diffing against previous audits, and rendering the final report.

### Manifest Handling

The manifest provides codebase structure, dependency relationships, component metadata, and documentation pointers. Three scenarios:

- **Manifest exists** — Core uses it directly. Richest input: human-curated component boundaries, risk tags, stability markers, architectural docs.
- **No manifest, quick scan** — Core infers structure on the fly from directory conventions, package boundaries, and import analysis. Good enough for single-pass analysis. No file persisted.
- **No manifest, thorough audit** — Core generates a manifest and surfaces it to the user for review before proceeding. Essentially a guided `varp:init` as the first step of the audit. The generated manifest can be saved for future runs.

This means the tool works without any setup for casual use, but rewards investment in a curated manifest with better analysis quality. The tool earns the right to ask for more input by proving value on the quick scan first.

Varp's component discovery supports both vertical slicing (feature-based folders) and horizontal architectures (controllers/services/repositories), reassembling vertical components from category-based folder structures.

## Audit-Specific Execution Details

When Core selects orchestrated mode for an audit goal, the audit package provides the decomposition strategy:

### Plan Generation

1. **Map the risk surface** — read the manifest, identify components that touch external input, data storage, auth, crypto, secrets, network boundaries. Tag by risk tier.
2. **Match rules to components** — for each rule in the ruleset, determine which components are relevant. Not every rule applies everywhere.
3. **Generate component scan tasks** — one per relevant (component, rule category) pair. Each task gets the component's code context and the applicable ruleset excerpt.
4. **Generate cross-cutting tasks** — analysis spanning multiple components: data flow tracing, authentication chain verification, secrets scanning.
5. **Generate synthesis task** — aggregates all findings.

### Scheduling

All audit tasks are read-only, so scheduling is straightforward:

```
Wave 1: Component scan tasks (fully parallel)
Wave 2: Cross-cutting tasks (parallel, may use wave 1 outputs)
Wave 3: Synthesis
```

Risk-priority ordering within waves ensures the most critical components are scanned first. If the audit is interrupted or budget-constrained, findings from the highest-risk areas are already available.

### Redundancy

For thorough audits, the decomposition strategy can schedule redundant passes — multiple agents reviewing the same component independently. Findings corroborated by multiple agents are flagged as higher confidence. This is a knob controlled by the `--thorough` flag or the risk tier of the component.

### Supervision

Varp Core's supervision handles agent failures: timeouts are retried, persistent failures are logged. The report notes which components were not fully audited. Since audit tasks are read-only and idempotent, retry is always safe.

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

Model selection is an internal decision made by Core's strategy layer. Users don't configure this.

| Role | Model | Rationale |
|------|-------|-----------|
| Single-pass analysis | Sonnet (1M context) | Large context, good quality/cost balance |
| Orchestrated: planner | Opus | Deep reasoning for structure and compliance mapping |
| Orchestrated: scan agents | Sonnet (1M context) | Parallel instances, cost-sensitive, large context |
| Orchestrated: cross-cutting | Sonnet (1M context) | Broad context across components |
| Orchestrated: synthesis | Opus | Judgment for deduplication and ranking |
| Quick scan / CI | Haiku or Sonnet | Speed-optimized for fast feedback |

## Non-Functional Requirements

**Consistency** — the report format and finding schema are identical across all execution modes. Downstream consumers (dashboards, CI, ticket systems) never need to know how the analysis was performed.

**Determinism and confidence** — LLM outputs vary between runs. The confidence field on findings is honest about this. Multi-agent corroboration (in orchestrated mode) increases confidence. Single-pass findings are inherently lower confidence but faster and cheaper.

**Cost management** — Core's strategy layer respects budget constraints. Given a cost ceiling, it maximizes coverage by prioritizing high-risk components and critical rules. Partial audits with clear coverage gaps are better than no audit.

**Latency** — quick scans should complete in seconds to low minutes (CI-compatible). Full audits can take longer but should provide incremental output as waves complete.

**Security** — Varp Audit handles source code. Code confidentiality, prompt injection via malicious code patterns, and audit trail integrity all apply. Self-hosted model support is important for enterprise adoption.

**Traceability** — every finding traces back to specific code locations and specific rules. Vague findings are worse than no findings — they erode trust in the tool.

## Monorepo Structure

```
packages/
  core/       — manifest, strategy, scheduler, execution, supervision
  audit/      — rulesets, audit goal construction, reporter, audit CLI
  (future)
  migrate/    — migration planning, framework upgrade strategies
  document/   — documentation generation
  test/       — test generation
```

Shared CLI/MCP interface:

```
varp plan              — implementation planning (core)
varp audit             — compliance auditing (audit)
varp plan-migrate      — migration planning (migrate)
```

Each package composes with Core. Core owns execution strategy. Packages own domain knowledge and goal construction.

## Open Questions

- **False positive handling** — how should acknowledged findings be suppressed? Inline annotations (`// varp-audit-ignore: SQL-INJ-01`), a suppression file, or acknowledged findings tracked in the report history?
- **Incremental audits** — can we efficiently audit only what changed since the last run? Requires mapping code changes to affected rules — non-trivial dependency analysis.
- **Strategy threshold tuning** — the boundary between single-pass and orchestrated mode needs empirical calibration. Too eager to orchestrate wastes money; too reluctant misses issues in large codebases.
- **Core strategy API** — how do packages communicate their decomposition strategy to Core? Core needs to know how to partition work, but the partitioning logic is domain-specific. The interface between packages and Core's strategy layer needs careful design.
- **Integration points** — CLI done, CI next. IDE integration and dashboard/reporting platform are future considerations.
- **Multi-repo** — enterprise codebases span multiple repositories. The manifest supports this conceptually, but cross-repo orchestration needs design.
- **Regulatory certification** — can Varp Audit's reports be used as evidence in actual compliance audits (SOC 2, etc.)? Requires understanding what auditors accept and potentially partnering with audit firms. Long-term consideration.

## Resolved Questions

- **Ruleset authoring** — YAML frontmatter + markdown body. See `rulesets/owasp-top-10.md` for the format.
- **Self-audit** — works. See `docs/examples/self-audit-report.md` for a report of the tool auditing itself against OWASP Top 10.
