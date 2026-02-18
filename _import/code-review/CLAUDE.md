# CLAUDE.md

Compliance-focused code auditing using multi-agent orchestration. Analyzes full codebases against compliance frameworks (OWASP, HIPAA, PCI-DSS). Will merge into the [Varp](https://github.com/varp) monorepo as `packages/audit`.

## Structure

```
packages/core/                  # Orchestration engine, agents, API client
  src/agents/                   # Generic review agents (7 active, weighted)
  src/planner/                  # Compliance audit pipeline
    ruleset-parser.ts           # Markdown ruleset → structured rules
    planner.ts                  # Files + rules → 3-wave audit plan
    findings.ts                 # Findings schema, deduplication, reporting
    prompt-generator.ts         # Task + rules → Claude prompts + response parser
    types.ts                    # Ruleset, AuditTask, AuditPlan types
apps/cli/                       # Bun CLI (primary interface)
rulesets/                       # Compliance framework definitions
docs/                           # Design documents and research
```

**Dependency flow**: cli → core
**Build** (Turborepo): core → cli

## Commands

```bash
bun run build              # All packages (dependency order)
bun run test               # All tests
bun run lint               # All packages

cd apps/cli && bun run dev <path>     # Run CLI
cd packages/core && bun run dev       # Watch mode
cd apps/cli && bun run build:binaries # Platform executables
```

## Audit Planner (`packages/core/src/planner/`)

The planner takes discovered files + a parsed ruleset and generates a 3-wave audit plan:

1. **Wave 1** — Component scans (parallel). Each task checks one component against one rule category.
2. **Wave 2** — Cross-cutting analysis (parallel). Data flow tracing, auth chain completeness, secrets management.
3. **Wave 3** — Synthesis. Deduplicate findings, compute coverage, produce `ComplianceReport`.

**Rulesets** are markdown with YAML frontmatter. Rules have: id, severity, appliesTo tags, compliant/violation patterns, what-to-look-for lists, false positive guidance.

**Findings** use a 5-level severity (critical/high/medium/low/informational). Duplicate findings from multiple tasks are corroborated — same rule + overlapping location = merged with boosted confidence.

**Prompt generator** builds system/user prompts per task type: component scan prompts embed the relevant rules, cross-cutting prompts embed the pattern objective + related rules. Response parser handles LLM output variations (markdown fences, snake_case fields, severity normalization, missing locations).

**Varp integration**: Component grouping and wave scheduling will be replaced by varp's manifest and scheduler post-merge. See `docs/research/varp-integration.md`.

## Generic Agents (`packages/core/src/agents/`)

Agents defined in `packages/core/src/agents/<name>.ts`. Each has `name`, `weight`, `systemPrompt`, `userPromptTemplate`, `parseResponse`.

| Agent | Weight | Focus |
|-------|--------|-------|
| Correctness | 22% | Logic errors, type safety, null handling |
| Security | 22% | Injection, XSS, auth, crypto |
| Maintainability | 15% | Complexity, documentation, error handling |
| Performance | 13% | Algorithmic complexity, memory, DB queries |
| Edge Cases | 13% | Boundaries, race conditions, resource limits |
| Accessibility | 10% | WCAG, keyboard nav, screen readers |
| Documentation | 5% | JSDoc/TSDoc, API docs |

Weights **must sum to 1.0** (validated on module load). `dependency-security` agent exists but disabled (weight 0).

Orchestrator (`packages/core/src/orchestrator.ts`) runs all agents via `Promise.allSettled` — one failure doesn't abort the audit. Score = weighted average.

## Dual Discovery

Two file discovery implementations exist:
- `packages/core/src/discovery.ts` — Bun-specific (`import { Glob } from "bun"`)
- `packages/core/src/discovery-node.ts` — Node.js (`glob` package)

**When modifying discovery, update BOTH files.** CLI uses Bun version, core exports Node version.

## Common Tasks

**New agent**: Create in `packages/core/src/agents/`, export from `index.ts`, rebalance all weights to sum 1.0.

**New ruleset**: Add to `rulesets/`. Follow the structure of `owasp-top-10.md` — YAML frontmatter + `## Category` → `### RULE-ID: Title` with Severity, Applies to, Compliant, Violation, What to look for, Guidance fields.

**Build errors**: Run `bun run build` from root.
