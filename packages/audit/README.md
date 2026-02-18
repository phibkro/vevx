# Audit Core

Multi-agent compliance audit engine. Runs specialized Claude-powered agents against a codebase to produce structured security and quality findings.

Depends on `@varp/core/lib` for manifest types (`Manifest`, `Component`, `componentPaths`).

## Architecture

```
Ruleset (markdown)  →  Planner  →  Audit Plan (waves + tasks)
                                        ↓
Source files        →  Chunker  →  Executor  →  Agents  →  Report
                                        ↓
                                   ModelCaller (injected by consumer)
```

## Key Modules

| Module | Purpose |
|--------|---------|
| `orchestrator.ts` | Runs generic agents against file chunks, scores results |
| `chunker.ts` | Splits source files into token-bounded chunks |
| `discovery.ts` | Finds source files (Bun runtime) |
| `discovery-node.ts` | Finds source files (Node.js runtime) |
| `errors.ts` | Domain error types |
| `planner/` | Compliance audit planning and execution (see `planner/README.md`) |
| `planner/manifest-adapter.ts` | Varp manifest integration — uses `@varp/core/lib` types, keeps own YAML parser |
| `planner/suppressions.ts` | False positive suppression via inline comments and `.audit-suppress.yaml` |
| `planner/diff-filter.ts` | Incremental audits — `--diff` flag filters to changed files with invalidation cascade |
| `agents/` | Specialized review agents (see `agents/README.md`) |

## Orchestrator

`runAudit()` is the entry point for generic (non-compliance) reviews. It:

1. Runs each weighted agent against the provided files
2. Collects findings with severity levels
3. Calculates per-agent and overall scores (weighted average)
4. Emits progress events during execution

Options: `model` (Claude model ID), `maxTokens` (per-call budget), and `jsonSchema` (for constrained decoding via `--json-schema`). Returns `ApiCallResult` with `text`, optional `structured` output, `usage` (token counts), and `costUsd`.

## Compliance Audit

For ruleset-based compliance auditing, use the planner pipeline:

1. `parseRuleset()` — parse markdown ruleset
2. `generatePlan()` — create 3-wave audit plan
3. `executeAuditPlan()` — run plan via Claude Code CLI
4. `printComplianceReport()` / `generateComplianceMarkdown()` — render results

See `planner/README.md` for details.
