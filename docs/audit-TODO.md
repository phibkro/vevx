# Audit Package — Remaining Work

## Done

- Ruleset parser (markdown → typed rules)
- Plan generator (files + rules → 3-wave task list)
- Findings schema (types, deduplication, corroboration, coverage)
- Prompt generator (tasks → Claude prompts, response parsing)
- Executor (plan → API calls → ComplianceReport)

## Next

### Compliance Reporter

Renders a `ComplianceReport` to terminal, markdown, and HTML. The existing `report/` module handles generic agent reports (score-based), not compliance reports with coverage tracking, rule references, and corroboration.

**What it needs:**
- Terminal output: summary table (severity counts), top findings with location + remediation, coverage gaps
- Markdown output: full report suitable for CI artifacts or PRs
- HTML output: styled report (extend existing HTML formatter)
- All formats should highlight coverage gaps ("these components/rules were NOT checked")

**Files:** `packages/core/src/planner/compliance-reporter.ts` (or extend `report/`)

### CLI Wiring

Wire the `varp audit --ruleset <name> <path>` command into the CLI.

**Flow:** parse args → discover files → load + parse ruleset → generate plan → execute plan → render report

**What it needs:**
- `--ruleset` flag: name (looks in `rulesets/`) or path to custom ruleset file
- `--model` flag: override default model
- `--concurrency` flag: max parallel API calls
- `--format` flag: terminal (default), markdown, html, json
- `--budget` flag (future): max tokens to spend, skip low-priority tasks when exhausted
- `--diff` flag (future): only audit changed files since last run
- Progress reporting using executor's `onProgress` callback

**Files:** `apps/cli/src/cli.ts` (add audit subcommand)

### Varp Core Integration (post-merge)

Replace stopgap implementations with varp core primitives:
- `groupIntoComponents()` → varp manifest's component definitions
- Wave scheduling → varp scheduler (critical path, hazard detection)
- Token budgeting → varp's budget-aware task selection

See `docs/research/varp-integration.md` for full mapping.
