# Audit Planner

Generates and executes compliance audit plans from markdown rulesets and discovered source files.

## Key Exports

| Export                         | Purpose                                                                                 |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| `parseRuleset()`               | Parses a markdown ruleset into structured rules                                         |
| `generatePlan()`               | Creates an `AuditPlan` from a ruleset and file list (manifest-aware)                    |
| `generatePrompt()`             | Builds system/user prompts for an audit task                                            |
| `parseAuditResponse()`         | Extracts findings from LLM responses (structured or text)                               |
| `AUDIT_FINDINGS_SCHEMA`        | JSON Schema for structured output (constrained decoding)                                |
| `executeAuditPlan()`           | Runs a plan end-to-end (waves → ModelCaller → report, with optional budget enforcement) |
| `printComplianceReport()`      | Renders report to terminal with ANSI colors                                             |
| `generateComplianceMarkdown()` | Renders report as markdown                                                              |
| `generateComplianceJson()`     | Renders report as JSON                                                                  |
| `findManifest()`               | Walks up directories looking for `varp.yaml`                                            |
| `loadManifestComponents()`     | Converts manifest components to `AuditComponent[]`                                      |
| `matchRulesByTags()`           | Tag-based rule→component matching (replaces filename heuristics)                        |
| `parseSuppressConfig()`        | Parses `.audit-suppress.yaml` config file                                               |
| `parseInlineSuppressions()`    | Scans files for `// audit-suppress` comments                                            |
| `applySuppressions()`          | Partitions findings into active and suppressed                                          |
| `getChangedFiles()`            | Gets changed files from `git diff`                                                      |
| `filterToChanged()`            | Filters discovered files to diff set                                                    |
| `expandWithDependents()`       | Adds files from dependent components (invalidation cascade)                             |
| `diffReports()`                | Diffs two `ComplianceReport`s — new, resolved, changed findings + trend                 |
| `printDriftReport()`           | Renders drift report to terminal with ANSI colors                                       |
| `generateDriftMarkdown()`      | Renders drift report as markdown                                                        |
| `generateDriftJson()`          | Renders drift report as JSON                                                            |

## How It Works

1. **Parse ruleset** — Extracts rules with severity, category, applies-to patterns, and guidance from markdown
2. **Group files** — Uses manifest components when `varp.yaml` exists (tag-based rule matching), falls back to directory-based clustering
3. **Match rules** — Maps rules to components via manifest tags or filename pattern heuristics
4. **Plan waves** — Wave 1 (component scans, parallel), Wave 2 (cross-cutting, parallel), Wave 3 (synthesis, in-process)
5. **Execute** — Runs wave 1 and 2 tasks via `ModelCaller` with bounded concurrency and structured output (constrained decoding via `--json-schema`), then synthesizes in-process (dedup, suppressions, coverage). Real token usage and cost are captured from API responses when available. When `budget` is set, tracks cumulative estimated tokens and skips low-priority tasks when exhausted (emits `task-skipped` events).
6. **Suppress** — Applies inline and config-based suppressions to filter known false positives
7. **Report** — Renders findings to terminal, markdown, or JSON
8. **Drift** (optional) — `diffReports(baseline, current)` compares against a previous report using `findingsOverlap()` for finding identity. Produces new/resolved/changed findings with trend (improving/stable/regressing)

## Types

| Type               | Fields                                                                                 |
| ------------------ | -------------------------------------------------------------------------------------- |
| `Ruleset`          | `meta`, `rules[]`, `crossCutting[]`                                                    |
| `Rule`             | `id`, `title`, `severity`, `category`, `appliesTo`, `whatToLookFor`, `guidance`        |
| `AuditPlan`        | `ruleset`, `components[]`, `waves[]`, `stats`                                          |
| `AuditTask`        | `id`, `type`, `wave`, `priority`, `component`, `files[]`, `rules[]`, `estimatedTokens` |
| `ComplianceReport` | `ruleset`, `summary`, `findings[]`, `coverage`, `metadata`                             |
| `DriftReport`      | `baseline`, `current`, `new[]`, `resolved[]`, `changed[]`, `summary`                   |

## Rulesets

Rulesets are markdown documents with YAML frontmatter and structured rule definitions. See `rulesets/` for examples (e.g., `owasp-top-10.md`).
