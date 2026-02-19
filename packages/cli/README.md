# Varp CLI

Command-line interface for Varp. Subcommands for compliance auditing, manifest linting, dependency graphs, doc freshness, and plan validation.

## Install

```bash
bun install
bun run build
```

## Audit

Run a compliance audit against a ruleset.

```bash
varp audit <path> [options]
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--ruleset <name>` | `owasp-top-10` | Ruleset name or path |
| `--model <name>` | `claude-sonnet-4-5-20250929` | LLM model for analysis |
| `--concurrency <n>` | `5` | Max parallel API calls per wave |
| `--format text\|json\|markdown` | `text` | Output format |
| `--output <path>` | stdout | Write report to file |
| `--quiet` | | Suppress progress output |
| `--diff [ref]` | `HEAD` | Incremental audit — only changed files |
| `--budget <tokens>` | unlimited | Max estimated tokens; skips low-priority tasks when exceeded |
| `--baseline <path>` | | Compare against a previous report JSON for drift tracking |

### Examples

```bash
# Full audit against OWASP Top 10
varp audit ./src

# Audit with a specific ruleset file
varp audit ./src --ruleset ./my-rules.md

# Incremental audit (only files changed since HEAD)
varp audit ./src --diff

# Incremental audit against a specific commit
varp audit ./src --diff main

# Save JSON report for later drift comparison
varp audit ./src --format json --output baseline.json

# Compare against a previous audit
varp audit ./src --baseline baseline.json

# Budget-constrained audit (skip low-priority tasks after 500k tokens)
varp audit ./src --budget 500000

# CI pipeline: JSON output, fail on critical findings
varp audit ./src --format json --quiet > report.json

# Combine incremental + drift + budget
varp audit ./src --diff main --baseline last-audit.json --budget 200000
```

### How It Works

1. **Discover** — recursively finds source files, respects `.gitignore`
2. **Filter** (if `--diff`) — keeps only changed files, expands to dependent components via manifest
3. **Parse ruleset** — extracts rules with severity, categories, and patterns from markdown
4. **Plan** — groups files into components (manifest-aware or heuristic), matches rules to components, generates 3-wave audit plan
5. **Execute** — Wave 1 (component scans, parallel) -> Wave 2 (cross-cutting analysis, parallel) -> Wave 3 (synthesis, in-process deduplication + corroboration)
6. **Suppress** — filters known false positives via inline comments and config file
7. **Report** — renders findings in chosen format
8. **Drift** (if `--baseline`) — diffs against previous report, shows new/resolved/changed findings with trend

### Suppressions

Suppress known false positives two ways:

**Inline comments** in source code:

```ts
// audit-suppress BAC-01 reason: auth handled by gateway
app.get("/internal/health", handler);
```

The comment suppresses the finding on the same line or the next line.

**Config file** at `.audit-suppress.yaml` in the audit target directory:

```yaml
suppressions:
  - rule: BAC-01
    file: src/internal/health.ts
    reason: Internal endpoint, auth handled by API gateway
  - rule: CRYPTO-01
    glob: "test/**"
    reason: Test fixtures use hardcoded keys intentionally
```

Each entry requires `rule` and `reason`. Optionally scope with `file` (exact path) or `glob` (pattern).

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | Audit completed, no critical findings |
| `1` | Critical findings detected |

## Other Subcommands

```bash
varp lint                   # Lint manifest (imports, links, freshness, stability)
varp graph                  # Render dependency graph (ASCII, default)
varp graph --format mermaid # Render as Mermaid diagram
varp graph --tags           # Group components by tag
varp graph --no-color       # Superscript tag markers (no ANSI)
varp graph --no-tags        # Hide tag markers
varp graph --no-stability   # Hide stability badges
varp freshness              # Check doc freshness across components
varp validate <plan.xml>    # Validate plan against manifest
```

Each accepts `--manifest <path>` (default: `./varp.yaml`).
