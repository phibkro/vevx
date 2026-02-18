# Varp

Manifest-aware context management for AI agent orchestration. A Claude Code plugin that adds dependency-aware scheduling, doc freshness tracking, and capability enforcement to multi-agent workflows.

## What It Does

Varp manages the gap between what agents know and what's actually true. It tracks which components exist, how they depend on each other, and whether their documentation is current — then uses that information to schedule work safely and catch mistakes.

- **Manifest** (`varp.yaml`) — declares project components, paths, dependencies, and doc locations
- **Plans** (`plan.xml`) — declare tasks with read/write scopes, verified by contracts
- **Orchestrator** — schedules tasks into parallel waves, enforces capability boundaries, handles failures

## Install

**Prerequisites:** [Bun](https://bun.sh), [Claude Code](https://claude.ai/claude-code) with plugin support.

```bash
# From the marketplace
/plugin marketplace add phibkro/varp
```

Or install from source:

```bash
git clone <repo-url> varp && cd varp
bun install && turbo build
claude plugin add /path/to/varp
```

## Setup

### 1. Create a Manifest

Create `varp.yaml` at your project root — or let Varp scaffold it:

```
/varp:init
```

The init skill scans your project structure, infers components and dependencies (with Nx, Turborepo, or moon graph import when available), and generates the manifest for your review.

Or write one manually:

```yaml
varp: 0.1.0

auth:
  path: ./src/auth
  tags: [security]
  stability: stable

api:
  path: ./src/api
  deps: [auth]
  env: [DATABASE_URL]
  test: "bun test src/api --timeout 5000"

web:
  path: ./src/web
  deps: [auth, api]
```

Only `path` is required. See [Manifest Schema](packages/core/src/manifest/README.md) for the full field reference.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Component source directory |
| `deps` | string[] | no | Components this one depends on |
| `docs` | string[] | no | Doc paths outside the component's directory |
| `tags` | string[] | no | Freeform labels for filtering and grouping |
| `test` | string | no | Custom test command (overrides `*.test.ts` discovery) |
| `env` | string[] | no | Required environment variables (informational) |
| `stability` | enum | no | `stable`, `active`, or `experimental` |

### 2. Write Component Docs

Each component uses the README.md convention for doc visibility:

- **`{path}/README.md`** — Public. Loaded when tasks read from or write to the component. Auto-discovered.
- **`{path}/docs/*.md`** — Private. Loaded only when tasks write to the component. Auto-discovered.
- **`docs:` field** — Only needed for docs outside the component's path tree.

Start minimal — even a few sentences per doc is useful.

### 3. Verify

Start a Claude Code session. You should see:

```
Varp project: v0.1.0
Components: auth, api, web (3)
```

Run `/varp:status` for the full project state report.

## Workflow

### Plan

```
/varp:plan add rate limiting to auth endpoints
```

The planner loads your manifest, asks clarifying questions, decomposes the feature into tasks with read/write scopes (`touches`), sets resource budgets, writes contracts (preconditions, invariants, postconditions), and outputs `plan.xml`.

### Execute

```
/varp:execute
```

The orchestrator computes execution waves from task dependencies, dispatches tasks to subagents with capability constraints, verifies file changes stay within declared scope, runs postconditions, handles failures with restart strategies derived from the dependency graph, and writes execution metrics to `log.xml`.

### Review

```
/varp:review
```

Diffs plan expectations against actual results — which tasks completed, failed, or were skipped; per-task resource consumption vs budget; capability violations; doc freshness; and recommended next action.

### Status

```
/varp:status
```

Project state at any time — component registry, doc freshness, active plan progress, data hazards, and critical path.

## Architecture

```
varp.yaml                Source of truth for project structure
  |
  v
MCP Server               Deterministic logic: parsing, scheduling, enforcement
  |
  v
Skills (5)               Workflow protocols: init, plan, execute, review, status
  |
  v
Hooks (3)                Lifecycle: session context, subagent injection, freshness tracking
```

The MCP server exposes pure functions. Skills structure agent behavior by loading protocols. Hooks enforce conventions at lifecycle boundaries.

## Packages

| Package | Path | Description |
|---------|------|-------------|
| `@varp/core` | `packages/core/` | MCP server — manifest, plan, scheduler, enforcement tools |
| `@varp/audit` | `packages/audit/` | Compliance audit engine — multi-agent code review |
| `@varp/plugin` | `packages/plugin/` | Claude Code plugin — skills, hooks, plugin manifest |
| `@varp/cli` | `apps/cli/` | Unified CLI for varp tools |

## Design Docs

| Doc | Purpose |
|-----|---------|
| [Design Principles](docs/core/design-principles.md) | Problem, core principles, agent model |
| [Architecture](docs/core/design-architecture.md) | Manifest, plans, orchestrator, concurrency |
| [Design Notes](docs/core/design-notes.md) | Feedback loops, open questions, extensions |
| [Implementation Status](docs/core/implementation-status.md) | What's built, what changed, what's deferred |
| [Audit Design](docs/audit/design.md) | Compliance audit engine design |

## Developer Reference

| Doc | Purpose |
|-----|---------|
| [Manifest Schema](packages/core/src/manifest/README.md) | `varp.yaml` format reference |
| [Plan Schema](packages/core/src/plan/README.md) | `plan.xml` format reference |
| [MCP Tool API](packages/core/src/README.md) | Tool signatures and types |
| [Internal Architecture](packages/core/src/docs/architecture.md) | Algorithms and data flow |

## Development

```bash
bun install              # install all workspace deps
turbo build              # build all packages
turbo test               # 483 tests across all packages
cd packages/core
  bun run check          # format + lint + shellcheck + build
  bun run typecheck      # tsc --noEmit
```

**Stack:** Bun, Turborepo, TypeScript (ES2022, ESM only), Zod, MCP SDK, fast-xml-parser.
