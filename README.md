# vevx

Agent toolkit for [Claude Code](https://claude.ai/claude-code). A monorepo of plugins that give AI coding agents structural awareness of codebases.

## Packages

| Package | Description | Deps |
| --- | --- | --- |
| [`@vevx/kiste`](packages/kiste/) | Git-backed artifact index. Tags, provenance, co-change, full-text search over commit history. | — |
| [`@vevx/varp`](packages/varp/) | Dependency analysis and agent orchestration. Manifest-driven: structural grouping, doc freshness, coupling diagnostics, plan validation, task scheduling. | kiste |
| [`@vevx/kart`](packages/kart/) | IDE interface for AI agents. Progressive code disclosure, LSP integration, AST-aware editing. 24 MCP tools. | — |
| [`@vevx/audit`](packages/audit/) | Multi-agent compliance audit engine. Ruleset-based code review with 3-wave planner. | varp |
| [`@vevx/havn`](packages/havn/) | Default Claude Code plugin setup. Builder/reviewer agents, project memory, git hooks, plugin auto-detection. | — |

```
kiste ← varp ← audit
kart (standalone)
havn (standalone)
```

## Install

**Prerequisites:** [Bun](https://bun.sh), [Claude Code](https://claude.ai/claude-code) with plugin support.

```bash
# As Claude Code plugins
claude plugin add https://github.com/phibkro/vevx/tree/main/packages/varp
claude plugin add https://github.com/phibkro/vevx/tree/main/packages/kart
claude plugin add https://github.com/phibkro/vevx/tree/main/packages/havn

# As npm packages
bun add @vevx/varp @vevx/kart @vevx/kiste
```

From source:

```bash
git clone https://github.com/phibkro/vevx.git && cd vevx
bun install && turbo build
```

## Development

```bash
bun install              # install all workspace deps
turbo build              # build all packages
turbo test               # all tests across all packages
turbo check              # format + lint + build
```

**Stack:** Bun, Turborepo, TypeScript (ES2022, ESM only), Zod, Effect TS, MCP SDK.

## Docs

- [Design Principles](docs/designs/001/design-principles.md) — Problem statement, core principles, agent model
- [Architecture](docs/designs/001/design-architecture.md) — Manifest, plans, orchestrator, concurrency
- [Manifest Schema](packages/varp/src/manifest/README.md) — `varp.yaml` format reference
- [MCP Tool API](packages/varp/README.md) — Varp tool signatures and types
