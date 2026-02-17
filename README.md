# Varp

Manifest-aware context management for AI agent orchestration. A Claude Code plugin that adds dependency-aware scheduling, doc freshness tracking, and capability enforcement to multi-agent workflows.

## What It Does

Varp manages the gap between what agents know and what's actually true. It tracks which components exist, how they depend on each other, and whether their documentation is current — then uses that information to schedule work safely and catch mistakes.

- **Manifest** (`varp.yaml`) — declares project components, paths, dependencies, and doc locations
- **Plans** (`plan.xml`) — declare tasks with read/write scopes, verified by contracts
- **Orchestrator** — schedules tasks into parallel waves, enforces capability boundaries, handles failures

## Quick Start

```bash
# Install dependencies
bun install

# Build the MCP server
bun run build

# Run tests
bun test
```

### Using as a Claude Code Plugin

1. Add a `varp.yaml` to your project root (see [Manifest Schema](src/manifest/README.md))
2. Install the plugin: `claude plugin add /path/to/varp`
3. Start a session — the `SessionStart` hook shows project state automatically
4. Use skills:
   - `/varp:status` — project state report
   - `/varp:plan` — decompose a feature into a verifiable plan
   - `/varp:execute` — run a plan with capability enforcement
   - `/varp:review` — review execution results and decide next steps

## Architecture

```
varp.yaml                Source of truth for project structure
  |
  v
MCP Server (12 tools)    Deterministic logic: parsing, scheduling, enforcement
  |
  v
Skills (4)               Workflow protocols: plan, execute, review, status
  |
  v
Hooks (3)                Lifecycle: session context, subagent injection, freshness tracking
```

The MCP server exposes pure functions. Skills structure agent behavior by loading protocols. Hooks enforce conventions at lifecycle boundaries. See [Design Principles](docs/design-principles.md) for the full rationale.

## Documentation

| Doc | Purpose |
|-----|---------|
| [Design Principles](docs/design-principles.md) | Problem, core principles, agent model |
| [Architecture](docs/design-architecture.md) | Manifest, plans, orchestrator, concurrency |
| [Design Notes](docs/design-notes.md) | Feedback loops, open questions, related work |
| [Getting Started](docs/getting-started.md) | Installation, setup, first workflow |
| [Manifest Schema](src/manifest/README.md) | `varp.yaml` reference |
| [Plan Schema](src/plan/README.md) | `plan.xml` reference |
| [API Surface](src/README.md) | MCP tool API |
| [Architecture (Internal)](src/docs/architecture.md) | Algorithms and data flow |

## Stack

- **Runtime**: Bun
- **Language**: TypeScript (ES2022)
- **MCP SDK**: `@modelcontextprotocol/sdk`
- **Validation**: Zod (schema-first types)
- **XML**: fast-xml-parser
- **YAML**: yaml
