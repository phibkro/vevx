# Varp Audit

Compliance-focused code auditing using multi-agent orchestration. Analyzes full codebases against specific compliance frameworks (OWASP, HIPAA, PCI-DSS) — not just diffs.

**Status:** Prototyping

## Structure

```
packages/core/    # Orchestration engine, agents, API client
apps/cli/         # CLI interface (Bun)
rulesets/         # Compliance framework definitions
docs/             # Design documents and research
```

## Development

```bash
bun install
bun run build
bun run test
```

## Docs

- [Design Document](docs/DESIGN.md) — architecture, audit lifecycle, model strategy
- [OWASP Top 10 Ruleset](rulesets/owasp-top-10.md) — 28 rules across 10 categories
