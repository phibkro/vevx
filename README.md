# Varp Audit

Compliance-focused code auditing using multi-agent orchestration. Analyzes full codebases against specific compliance frameworks (OWASP, HIPAA, PCI-DSS) — not just diffs.

**Status:** Prototyping

## Structure

```
packages/core/    # Orchestration engine, agents, audit planner
  src/planner/    # Ruleset parser, plan generator, findings schema, prompt generator
  src/agents/     # Generic review agents (7 active)
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

## How It Works

1. **Parse** a compliance ruleset (structured markdown with rules, severity, code patterns)
2. **Plan** an audit: match rules to code components, generate a 3-wave execution plan
3. **Execute** component scans (wave 1), cross-cutting analysis (wave 2), synthesis (wave 3)
4. **Report** deduplicated findings with corroboration scoring and coverage tracking

## Docs

- [Design Document](docs/DESIGN.md) — architecture, audit lifecycle, model strategy
- [OWASP Top 10 Ruleset](rulesets/owasp-top-10.md) — 29 rules across 10 categories + 3 cross-cutting patterns
- [Varp Integration](docs/research/varp-integration.md) — how audit maps to varp's orchestration primitives
