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
varp lint                   # Lint manifest (imports, links, freshness, stability)
varp freshness              # Check doc freshness across components
varp validate <plan.xml>    # Validate plan against manifest
varp coupling               # Analyze component coupling (co-change + imports)
varp summary                # Project health digest (coupling, freshness, stability)
varp summary --json         # JSON output (also writes .varp/summary.json cache)
varp conventions            # Show component detection conventions
```

Each accepts `--manifest <path>` (default: `./varp.yaml`).

## Init

Scaffolds a `varp.yaml` by detecting layer directories (`controllers/`, `services/`, etc.) and domain directories. Components appearing across 2+ layers are automatically grouped.

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
