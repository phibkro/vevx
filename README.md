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
/plugin marketplace add phibkro/vevx
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

Either `path` or `paths` is required. See [Manifest Schema](packages/varp/src/manifest/README.md) for the full field reference.

| Field       | Type     | Required         | Description                                                |
| ----------- | -------- | ---------------- | ---------------------------------------------------------- |
| `path`      | string   | yes (or `paths`) | Single component source directory                          |
| `paths`     | string[] | yes (or `path`)  | Multiple source directories (can coexist with `path`)      |
| `deps`      | string[] | no               | Components or tags this one depends on                     |
| `docs`      | string[] | no               | Doc paths outside the component's directory                |
| `tags`      | string[] | no               | Labels for grouping — usable in `deps` and tool parameters |
| `test`      | string   | no               | Custom test command (overrides `*.test.ts` discovery)      |
| `env`       | string[] | no               | Required environment variables (informational)             |
| `stability` | enum     | no               | `stable`, `active`, or `experimental`                      |

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
Components: auth, api, web
```

Run `/varp:status` for the full project state report.

## Workflow

### Plan

```
/varp:plan add rate limiting to auth endpoints
```

The planner loads your manifest, asks clarifying questions, decomposes the feature into tasks with read/write scopes (`touches`), writes contracts (preconditions, invariants, postconditions), and outputs `plan.xml`.

### Execute

```
/varp:execute
```

The orchestrator computes execution waves from task dependencies, dispatches tasks to subagents with capability constraints, verifies file changes stay within declared scope, runs postconditions, handles failures with restart strategies derived from the dependency graph, and writes execution metrics to `log.xml`.

### Review

```
/varp:review
```

Diffs plan expectations against actual results — which tasks completed, failed, or were skipped; per-task resource consumption; capability violations; doc freshness; and recommended next action.

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
Skills                   Workflow protocols: init, plan, execute, review, status, coupling
  |
  v
Hooks                    Lifecycle: session start, subagent context, freshness tracking, stop
```

The MCP server exposes pure functions. Skills structure agent behavior by loading protocols. Hooks enforce conventions at lifecycle boundaries.

## Packages

| Package       | Path              | Description                                                                    |
| ------------- | ----------------- | ------------------------------------------------------------------------------ |
| `@vevx/varp`  | `packages/varp/`  | MCP server, CLI, skills, hooks — manifest, plan, scheduler, enforcement tools  |
| `@vevx/audit` | `packages/audit/` | Compliance audit engine + CLI (`varp-audit`) — multi-agent code review         |
| `@vevx/kiste` | `packages/kiste/` | Git-backed artifact index using Effect TS                                      |

## Design Docs

| Doc                                                         | Purpose                                     |
| ----------------------------------------------------------- | ------------------------------------------- |
| [Design Principles](docs/designs/001/design-principles.md)         | Problem, core principles, agent model       |
| [Architecture](docs/designs/001/design-architecture.md)            | Manifest, plans, orchestrator, concurrency  |
| [Design Notes](docs/designs/001/design-notes.md)                   | Feedback loops, open questions, extensions  |
| [Implementation Status](docs/designs/001/implementation-status.md) | What's built, what changed, what's deferred |
| [Audit Design](docs/audit/design.md)                        | Compliance audit engine design              |

## Developer Reference

| Doc                                                        | Purpose                      |
| ---------------------------------------------------------- | ---------------------------- |
| [Manifest Schema](packages/varp/src/manifest/README.md)    | `varp.yaml` format reference |
| [Plan Schema](packages/varp/src/plan/README.md)            | `plan.xml` format reference  |
| [MCP Tool API](packages/varp/README.md)                    | Tool signatures and types    |
| [Internal Architecture](packages/varp/docs/architecture.md) | Algorithms and data flow     |

## Development

```bash
bun install              # install all workspace deps
turbo build              # build all packages
turbo test               # all tests across all packages
turbo check              # format + lint + build (all packages)
turbo typecheck          # oxlint --type-aware --type-check (all packages)
```

**Stack:** Bun, Turborepo, TypeScript (ES2022, ESM only), Zod, MCP SDK, fast-xml-parser.
