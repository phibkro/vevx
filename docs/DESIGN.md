# Varp Audit — Design Document

**Status:** Draft
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

**Varp Audit** is a compliance-focused code auditing tool that uses multi-agent orchestration to perform structured, full-codebase analysis against specific compliance frameworks.

It is built on top of [Varp](https://github.com/varp), reusing its task decomposition, scheduling, supervision, and synthesis capabilities. Where Varp orchestrates agents that *write* code, Varp Audit orchestrates agents that *read and analyze* code.

**Differentiators:**

1. **Full codebase scope** — uses large context windows (up to 1M tokens) to trace data flows and architectural patterns across an entire repository, not just review individual changes.
2. **Compliance-framework-aware** — structured checking against specific standards (OWASP, HIPAA, PCI-DSS, GDPR, custom organizational rules), not generic bug detection.
3. **Multi-agent thoroughness** — redundant and cross-cutting analysis passes that catch issues single-pass tools miss.
4. **Audit-over-time** — tracks compliance drift by diffing findings against previous audit runs.

## Architecture

Varp Audit is a **separate tool that depends on Varp** for orchestration. It does not extend Varp's core; it uses Varp's MCP tools and adapts its skill protocols for the audit domain.

```
┌─────────────────────────────────────────┐
│              Varp Audit                  │
│                                         │
│  Rulesets    Audit Planner    Reporter   │
│  (compliance   (generates      (finding  │
│   frameworks)   Varp plans)    synthesis) │
│                                         │
├─────────────────────────────────────────┤
│              Varp (dependency)           │
│                                         │
│  Manifest  Scheduler  Execution  Review  │
│  (codebase  (waves,    (agent     (diff   │
│   structure) hazards)   dispatch)  & log) │
└─────────────────────────────────────────┘
```

### Key Components

**Rulesets** — compliance framework definitions, expressed as structured markdown documents. Each ruleset defines a set of rules, where each rule has a description, what to look for, severity, and which types of code components it applies to. Rulesets are the domain knowledge layer; they are not code, they are documents that audit agents interpret.

**Audit Planner** — takes a Varp manifest (codebase structure) and a ruleset, and generates a Varp-compatible plan. This is the intelligence layer: it decides which components need which checks, identifies cross-cutting concerns, and prioritizes by risk.

**Audit Agents** — the agents dispatched by Varp's execution layer. Each agent receives a task (scan component X against rules Y), the relevant code context, and the ruleset excerpt. Agents produce structured findings.

**Reporter** — aggregates findings from all agents, deduplicates, ranks by severity, and produces a structured audit report. Optionally diffs against a previous audit to highlight new, resolved, and regressed findings.

## Audit Lifecycle

### 1. Initialize

Run `varp:init` on the target codebase (or use an existing manifest). The manifest provides the component graph, dependency relationships, and documentation pointers.

The auditor selects a ruleset (or multiple) and an audit scope (full codebase, specific components, or changes since last audit).

### 2. Plan

The audit planner reads the manifest and the selected ruleset(s) and generates a plan with three categories of tasks:

**Component scan tasks** — one per relevant (component, rule category) pair. These are the bulk of the work. Each task is scoped to a single component and a subset of rules. They run independently and in parallel.

**Cross-cutting tasks** — analysis that spans multiple components. Data flow tracing (follow PII from ingestion to storage to deletion), authentication chain verification (are all entry points protected?), secrets scanning. These may depend on component scan results or require broader context.

**Synthesis task** — a final task that aggregates all findings into the audit report. Always runs last.

Scheduling is straightforward because all tasks are read-only:

```
Wave 1: All component scan tasks (fully parallel)
Wave 2: Cross-cutting tasks (parallel, may use wave 1 outputs)
Wave 3: Synthesis (single task)
```

Risk-priority ordering within waves ensures the most critical components are scanned first. If the audit is interrupted or budget-constrained, findings from the highest-risk areas are already available.

### 3. Execute

Varp dispatches agents per the plan. Each agent receives:

- The task definition (which component, which rules)
- Code context (files in the component, resolved via manifest)
- Relevant documentation (component README, architectural docs)
- The ruleset excerpt applicable to this task
- Output schema for findings

Agents produce structured findings, each with:

- **Rule reference** — which compliance rule this finding relates to
- **Severity** — critical, high, medium, low, informational
- **Location** — file path(s) and line range(s)
- **Evidence** — the specific code pattern or behavior observed
- **Explanation** — why this is a compliance concern
- **Remediation** — suggested fix or approach

Varp's supervision handles agent failures: timeouts are retried, persistent failures are logged and excluded from the report with a note that the component was not fully audited.

### 4. Synthesize

The reporter collects all findings and produces the audit report:

- Deduplicate findings that multiple agents flagged independently (this is expected and desirable — redundant passes catching the same issue increases confidence)
- Rank by severity and group by compliance rule, component, or both
- Calculate coverage: which components were scanned, which rules were checked, where are the gaps
- If a previous audit exists, compute the diff: new findings, resolved findings, regressions

### 5. Review

The audit report is the primary output. It should be actionable: each finding has enough context for a developer to understand the issue and fix it without re-investigating.

Over time, sequential audit runs build a compliance history for the codebase.

## Model Strategy

Different models serve different roles in the audit pipeline:

| Role | Model | Rationale |
|------|-------|-----------|
| Planner | Opus | Needs deep reasoning about codebase structure and compliance requirements to generate good task decomposition |
| Component scan | Sonnet (1M context) | Needs large context to see full component code + rules. Runs many instances in parallel, cost-sensitive |
| Cross-cutting analysis | Sonnet (1M context) | Needs broad context across multiple components for data flow tracing |
| Synthesis | Opus | Needs judgment to deduplicate, rank, and produce a coherent report |

Quick/shallow audits (CI integration, PR-adjacent checks) could use Opus in fast mode or Haiku for speed, with full audits reserved for periodic deep scans.

## Rulesets

Rulesets are markdown documents that encode compliance requirements in a form that LLM agents can interpret and apply. They are not formal rule engines — the LLM's interpretation is the "engine."

A ruleset contains:

- **Framework metadata** — name, version, scope, applicability
- **Rules** — each with an identifier, description, what compliant code looks like, what violations look like, severity, and which component types it applies to
- **Guidance** — contextual notes on interpretation, common false positives, edge cases

Example (abbreviated):

```markdown
# OWASP Top 10 — Injection (A03:2021)

## Rule: SQL-INJ-01 — Parameterized Queries

**Severity:** Critical
**Applies to:** Components tagged `database`, `api`, `backend`

**Compliant:** All SQL queries use parameterized queries or prepared statements.
**Violation:** String concatenation or template literals used to build SQL queries with user input.

**Guidance:** ORMs generally handle parameterization, but check for raw query escape hatches (e.g., `sequelize.query()`, `prisma.$queryRawUnsafe()`).
```

### Ruleset Design Principles

These principles emerged from writing the OWASP Top 10 ruleset and should guide all future rulesets.

**Concrete code patterns over abstract descriptions.** Each rule includes a "what to look for" section with language-specific code examples. LLMs pattern-match better against `prisma.$queryRawUnsafe()` than "check for ORM escape hatches." The examples are the rule; the description is context.

**False positive guidance in every rule.** Every rule includes notes on what is NOT a violation. `MD5` for cache keys is fine; `http://localhost` in development is fine; `JSON.parse()` is not insecure deserialization. Without this, audits drown in noise and lose trust.

**Defer to specialized tooling where appropriate.** LLMs should not attempt to be CVE databases or dependency scanners. The VULN-01 rule (known vulnerabilities) explicitly checks whether dependency auditing exists in the CI pipeline rather than trying to evaluate package versions. The right tool for the job: `npm audit` for CVEs, LLM agents for behavioral analysis that static tools cannot do.

**Cross-cutting patterns reference specific rules.** Wave 2 (cross-cutting) tasks like "trace PII data flows" are not standalone — they reference specific wave 1 rules (CRYPTO-01, LOG-02, AUTH-03) whose findings they build upon. This creates a dependency graph between rules, not just between tasks.

**Scope boundaries are explicit.** Each rule declares which component types it applies to (`API routes`, `database access layers`, `HTTP server configuration`). This enables the audit planner to skip irrelevant (component, rule) pairs rather than running every rule against every component.

Starting with hand-written rulesets for OWASP Top 10 is the pragmatic first step. Domain-specific frameworks (HIPAA, PCI-DSS) can be added as rulesets without changing the audit machinery.

## Audit Report Format

The specific format will evolve through use, but the report should be structured data (likely JSON or YAML) that can be rendered into human-readable formats (markdown, HTML, PDF). Key sections:

- **Summary** — overall compliance posture, risk score, coverage statistics
- **Findings** — the individual issues, grouped and ranked
- **Coverage** — what was checked, what wasn't, and why
- **Diff** (if applicable) — changes since last audit
- **Metadata** — timestamp, models used, ruleset versions, audit scope, cost

The structured format enables downstream tooling: dashboards, trend tracking, CI integration, ticket creation.

## Non-Functional Requirements

**Determinism and confidence** — LLM outputs vary. Redundant passes (multiple agents reviewing the same code) increase confidence. Findings corroborated by multiple agents should be flagged as higher confidence. The report should be transparent about what was checked and how many passes confirmed each finding.

**Cost management** — multi-agent full-codebase audits are token-intensive. The planner should support budget constraints: given N dollars, prioritize the highest-risk components and rules. Partial audits with clear coverage gaps are better than no audit.

**Latency** — full audits are not time-critical (run nightly or weekly). But the system should support quick scans (single component, single rule category) for CI integration or developer-initiated checks.

**Security** — the audit tool itself handles source code. Same concerns apply as to any AI code tool: code confidentiality, prompt injection via malicious code, and the integrity of the audit trail itself.

**Traceability** — every finding must trace back to specific code locations and the specific rule it violates. The audit report is an evidentiary document; vague findings are worthless.

## Open Questions

- **Ruleset authoring** — how much structure do rulesets need? Pure markdown is flexible but may lead to inconsistent rule interpretation across runs. A lightweight schema (YAML frontmatter + markdown body?) could help without over-formalizing.
- **False positive handling** — how should the system handle acknowledged/accepted findings? Inline code annotations (`// varp-audit-ignore: SQL-INJ-01`)? A separate suppression file?
- **Incremental audits** — can we efficiently audit only what changed since the last run? This requires mapping code changes to affected rules, which is a non-trivial dependency analysis.
- **Self-audit** — the tool should be able to audit itself. Dogfooding as a correctness check.
- **Integration points** — where does this plug in? CLI tool, CI/CD action, scheduled job, IDE integration? Probably CLI-first with CI as the second target.
- **Multi-repo** — enterprise codebases span multiple repositories. The manifest supports this conceptually, but the practical orchestration of cross-repo audits needs design.
