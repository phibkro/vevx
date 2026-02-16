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
  docs:
    - ./docs/auth/README.md
    - ./docs/auth/internal.md

api:
  path: ./src/api
  deps: [auth]
  docs:
    - ./docs/api/README.md
    - ./docs/api/internal.md

web:
  path: ./src/web
  deps: [auth, api]
  docs:
    - ./docs/web/README.md
    - ./docs/web/internal.md
```

See [Manifest Schema](manifest-schema.md) for the full reference.

### 2. Write Component Docs

For each component, create its README.md and internal docs:

- **README.md** — how to use the component from outside (API surface, behavioral assumptions, guarantees). Public: loaded when tasks read from or write to this component.
- **Internal doc** — how the component works inside (implementation details, algorithms, design decisions). Private: loaded only when tasks write to this component.

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
6. Output `plans/backlog/<feature>/plan.xml`

### Execute a Plan

Move the plan to in-progress:

```bash
mv plans/backlog/rate-limiting plans/in-progress/rate-limiting
```

Then run:

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

## File Structure

Plans are organized by lifecycle status:

```
plans/
  backlog/              Planned features, not yet started
    rate-limiting/
      plan.xml
  in-progress/          Currently executing (only one at a time)
    auth-refactor/
      plan.xml
      log.xml
  in-review/            Execution complete, awaiting human review
  blocked/              Waiting on external dependency
  done/                 Completed and approved
```

Status transitions are filesystem moves: `mv plans/in-progress/feature plans/in-review/feature`.

## MCP Tools

Varp exposes 11 MCP tools. Skills call these automatically, but you can also call them directly:

| Tool | Purpose |
|------|---------|
| `varp_read_manifest` | Parse manifest, return component registry |
| `varp_resolve_docs` | Resolve doc paths from task touches |
| `varp_invalidation_cascade` | Find transitively affected components |
| `varp_check_freshness` | Check doc staleness per component |
| `varp_parse_plan` | Parse plan XML |
| `varp_validate_plan` | Check plan consistency against manifest |
| `varp_compute_waves` | Group tasks into parallel execution waves |
| `varp_detect_hazards` | Find RAW/WAR/WAW data hazards |
| `varp_compute_critical_path` | Find longest dependency chain |
| `varp_verify_capabilities` | Check file changes vs declared scope |
| `varp_derive_restart_strategy` | Determine failure recovery approach |

## Next Steps

- Read the [Design Document](varp-design-document.md) for the full architecture and rationale
- See [Manifest Schema](manifest-schema.md) and [Plan Schema](plan-schema.md) for format references
- See [Interface](core/README.md) for the complete MCP tool API
