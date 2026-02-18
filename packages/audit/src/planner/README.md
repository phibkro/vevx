# Audit Planner

Generates audit execution plans from markdown rulesets and discovered source files.

## Key Exports

| Export | Purpose |
|--------|---------|
| `generatePlan()` | Creates an `AuditPlan` from a ruleset and file list |
| `parseRuleset()` | Parses a markdown ruleset into structured rules |

## How It Works

1. **Parse ruleset** — Extracts rules with severity, category, applies-to patterns, and guidance from markdown
2. **Group files** — Clusters source files into logical components by directory
3. **Match rules** — Maps rules to components based on file patterns and tag matching
4. **Prioritize** — Orders tasks by highest severity of applicable rules
5. **Plan waves** — Groups tasks into execution waves (wave 1 = critical/high severity)

## Types

| Type | Fields |
|------|--------|
| `Ruleset` | `meta`, `rules[]`, `crossCutting[]` |
| `Rule` | `id`, `title`, `severity`, `category`, `appliesTo`, `whatToLookFor`, `guidance` |
| `AuditPlan` | `ruleset`, `components[]`, `waves[]`, `stats` |
| `AuditTask` | `id`, `type`, `wave`, `priority`, `component`, `files[]`, `rules[]`, `estimatedTokens` |

## Rulesets

Rulesets are markdown documents with structured rule definitions. See `rulesets/` for examples (e.g., `owasp-top-10.md`).
