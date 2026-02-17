# Getting Started

Set up Varp on a project and run your first workflow.

## Prerequisites

- [Bun](https://bun.sh) (runtime, package manager, test runner)
- [Claude Code](https://claude.ai/claude-code) with plugin support

## Install Varp

```bash
# Clone and build
git clone <repo-url> varp
cd varp
bun install
bun run build
```

## Add Varp to Your Project

### 1. Create a Manifest

Create `varp.yaml` at your project root. This declares your components, their file paths, dependencies, and documentation locations.

```yaml
varp: 0.1.0

auth:
  path: ./src/auth
  tags: [security]
  stability: stable
  docs:
    - ./docs/auth/internal.md

api:
  path: ./src/api
  deps: [auth]
  env: [DATABASE_URL]
  test: "bun test src/api --timeout 5000"

web:
  path: ./src/web
  deps: [auth, api]
```

Only `path` is required. Optional fields like `tags`, `stability`, `env`, and `test` give the planner richer context but can be added incrementally. See [Manifest Schema](../src/manifest/README.md) for the full reference. See [Plan Schema](../src/plan/README.md) for the plan XML format.

### 2. Write Component Docs

For each component, create its README.md and internal docs:

- **README.md** — how to use the component from outside (API surface, behavioral assumptions, guarantees). Public: loaded when tasks read from or write to this component. Place at `{component.path}/README.md` for auto-discovery.
- **Internal doc** — how the component works inside (implementation details, algorithms, design decisions). Private: loaded only when tasks write to this component. List explicitly in `docs:`.

Start minimal. Even a few sentences per doc is useful — the system degrades gracefully with sparse documentation.

### 3. Install the Plugin

```bash
claude plugin add /path/to/varp
```

This registers Varp's MCP tools, skills, and hooks with Claude Code.

### 4. Verify

Start a Claude Code session in your project directory. You should see:

```
Varp project: my-project (v0.1.0)
Components: auth, api, web (3)
```

Then run `/varp:status` to see the full project state report — component registry, doc freshness, and any active plans.

## Workflow

### Plan a Feature

```
/varp:plan add rate limiting to auth endpoints
```

The planner agent will:
1. Load your manifest to understand project structure
2. Ask clarifying questions about the feature
3. Decompose into tasks with read/write scopes (`touches`)
4. Set resource budgets per task
5. Write contracts (preconditions, invariants, postconditions)
6. Output `plan.xml` to project memory

### Execute a Plan

```
/varp:execute
```

The orchestrator will:
1. Compute execution waves from task dependencies
2. Dispatch tasks to subagents with capability constraints
3. Verify file changes stay within declared scope
4. Run postconditions after each task
5. Handle failures with restart strategies derived from the dependency graph
6. Write execution metrics to `log.xml`

### Review Results

```
/varp:review
```

The review agent diffs plan expectations against actual results:
- Which tasks completed, failed, or were skipped
- Per-task resource consumption vs budget
- Capability violations and restart decisions
- Doc freshness and invalidation cascades
- Recommended next action (continue, replan, done)

### Check Status

```
/varp:status
```

Shows current project state at any time — component registry, doc freshness, active plan progress, data hazards, and critical path.

## Next Steps

- Read the [Design Principles](design-principles.md) and [Architecture](design-architecture.md) for the full rationale
- See [Manifest Schema](../src/manifest/README.md) and [Plan Schema](../src/plan/README.md) for format references
- See the core [README](../src/README.md) for the MCP tool API surface
