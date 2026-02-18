# CLI

Command-line interface for Varp tools. Wraps the audit engine with progress display, watch mode, and compliance auditing.

## Usage

### Generic Review

```bash
varp [path] [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--model` | `claude-sonnet-4-5-20250929` | Claude model to use |
| `--max-tokens` | `8192` | Max tokens per API call |
| `--format` | `text` | Output format (`text` or `json`) |
| `--output` | — | Write report to file |
| `--parallel` | — | Run agents in parallel |
| `--watch` | — | Re-run on file changes |
| `--verbosity` | `normal` | Output detail level |

### Compliance Audit

```bash
varp audit <path> --ruleset <name> [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--ruleset` | (required) | Ruleset name (e.g., `owasp-top-10`) or path to custom ruleset |
| `--model` | `claude-sonnet-4-5-20250929` | Claude model to use |
| `--concurrency` | `3` | Max parallel API calls |
| `--format` | `text` | Output format (`text`, `json`, `markdown`) |
| `--output` | — | Write report to file |

## Architecture

```
parseCliArgs()  →  runAuditFlow()     →  @varp/audit orchestrator (generic review)
                   runAuditCommand()  →  @varp/audit planner pipeline (compliance audit)
```

Auth is handled by Claude Code's own session — no API key required.
