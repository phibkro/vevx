# Varp CLI

Fast, deterministic manifest tooling. Dependency graphs, linting, doc freshness, plan validation, and coupling analysis.

## Install

```bash
bun install
bun run build
```

## Commands

```bash
varp init                   # Scaffold varp.yaml from project structure
varp graph                  # Render dependency graph (ASCII, default)
varp graph --format mermaid # Render as Mermaid diagram
varp graph --tags           # Group components by tag
varp graph --no-color       # Superscript tag markers (no ANSI)
varp graph --no-tags        # Hide tag markers
varp graph --no-stability   # Hide stability badges
varp graph --direction LR   # Left-to-right layout (mermaid only)
varp lint                   # Lint manifest (errors + warning summary)
varp lint --details         # Show all warnings grouped by category
varp lint --suppress        # Suppress current warnings
varp lint --format json     # JSON output
varp freshness              # Check doc freshness across components
varp freshness --format json # JSON output
varp validate <plan.xml>    # Validate plan against manifest
varp validate --format json # JSON output
varp coupling               # Analyze component coupling (co-change + imports)
varp coupling --files       # File-level co-change edges with trend sparklines
varp coupling --hotspots    # Show hidden coupling hotspots only
varp coupling --neighborhood <file>  # Per-file neighborhood analysis
varp coupling --component <name>     # Filter to specific component
varp coupling --format json # JSON output
varp coupling --no-color    # Disable ANSI colors
varp summary                # Project health digest (coupling, freshness, stability)
varp summary --json         # JSON output (also writes .varp/summary.json cache)
varp conventions            # Show component detection conventions
varp conventions --format json # JSON output
```

Each command accepts `--manifest <path>` (default: `./varp.yaml`).

## Init

Scaffolds a `varp.yaml` by scanning for container dirs, indicator dirs, and layer dirs (MVC-style cross-layer detection). Use `varp conventions` to see the full detection config.

```bash
varp init   # detects project structure, writes varp.yaml
```

If no components are detected, writes a minimal template.

## Completions

```bash
varp completions bash > ~/.bash_completion.d/varp
varp completions zsh > ~/.zsh/completions/_varp
```

## Compliance Auditing

For AI-powered compliance auditing, use `@varp/audit`:

```bash
bun add @varp/audit
varp-audit audit src/ --ruleset owasp-top-10
```
