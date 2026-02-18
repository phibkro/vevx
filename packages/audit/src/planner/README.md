# Audit Planner

Generates and executes compliance audit plans from markdown rulesets and discovered source files.

## Key Exports

| Export | Purpose |
|--------|---------|
| `parseRuleset()` | Parses a markdown ruleset into structured rules |
| `generatePlan()` | Creates an `AuditPlan` from a ruleset and file list |
| `generatePrompt()` | Builds system/user prompts for an audit task |
| `parseAuditResponse()` | Extracts findings from LLM responses |
| `executeAuditPlan()` | Runs a plan end-to-end (waves → Claude CLI → report) |
| `printComplianceReport()` | Renders report to terminal with ANSI colors |
| `generateComplianceMarkdown()` | Renders report as markdown |
| `generateComplianceJson()` | Renders report as JSON |

## How It Works

1. **Parse ruleset** — Extracts rules with severity, category, applies-to patterns, and guidance from markdown
2. **Group files** — Clusters source files into logical components by directory
3. **Match rules** — Maps rules to components based on file patterns and tag matching
4. **Plan waves** — Wave 1 (component scans, parallel), Wave 2 (cross-cutting, parallel), Wave 3 (synthesis, in-process)
5. **Execute** — Runs wave 1 and 2 tasks via Claude Code CLI with bounded concurrency, then synthesizes in-process (dedup, coverage)
6. **Report** — Renders findings to terminal, markdown, or JSON

## Types

| Type | Fields |
|------|--------|
| `Ruleset` | `meta`, `rules[]`, `crossCutting[]` |
| `Rule` | `id`, `title`, `severity`, `category`, `appliesTo`, `whatToLookFor`, `guidance` |
| `AuditPlan` | `ruleset`, `components[]`, `waves[]`, `stats` |
| `AuditTask` | `id`, `type`, `wave`, `priority`, `component`, `files[]`, `rules[]`, `estimatedTokens` |
| `ComplianceReport` | `ruleset`, `summary`, `findings[]`, `coverage`, `metadata` |

## Rulesets

Rulesets are markdown documents with YAML frontmatter and structured rule definitions. See `rulesets/` for examples (e.g., `owasp-top-10.md`).
