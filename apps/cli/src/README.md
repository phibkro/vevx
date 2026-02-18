# CLI

Command-line interface for Varp tools. Currently wraps the audit engine with progress display and watch mode.

## Usage

```bash
varp [path] [options]
```

| Option | Default | Description |
|--------|---------|-------------|
| `--model` | `claude-sonnet-4-20250514` | Claude model to use |
| `--max-tokens` | `8192` | Max tokens per API call |
| `--format` | `text` | Output format (`text` or `json`) |
| `--output` | — | Write report to file |
| `--parallel` | — | Run agents in parallel |
| `--watch` | — | Re-run on file changes (via chokidar) |
| `--verbosity` | `normal` | Output detail level |

## Architecture

```
parseCliArgs()  →  runAuditFlow()  →  @varp/audit orchestrator
                        ↓
                   ora (spinner/progress)
```

The CLI parses args, calls `@varp/audit` for the actual audit, and displays progress via `ora` spinners. Watch mode uses `chokidar` for filesystem monitoring.

## Status

Experimental. Will expand to cover all varp tools (manifest, plan, scheduler) as a unified CLI.
