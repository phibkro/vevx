# Manifest Schema

Reference for `varp.yaml`, the component manifest that declares project structure.

## Example

```yaml
varp: 0.1.0
name: my-project

docs:
  getting-started:
    name: getting-started
    path: ./docs/getting-started.md
    load_on: [reads]

components:
  auth:
    path: ./src/auth
    docs:
      - name: interface
        path: ./docs/auth/interface.md
        load_on: [reads]
      - name: internal
        path: ./docs/auth/internal.md
        load_on: [writes]
      - name: examples
        path: ./docs/auth/examples.md
        load_on: [reads, writes]

  api:
    path: ./src/api
    depends_on: [auth]
    docs:
      - name: interface
        path: ./docs/api/interface.md
        load_on: [reads]
      - name: internal
        path: ./docs/api/internal.md
        load_on: [writes]

  web:
    path: ./src/web
    depends_on: [auth, api]
    docs:
      - name: interface
        path: ./docs/web/interface.md
        load_on: [reads]
      - name: internal
        path: ./docs/web/internal.md
        load_on: [writes]
```

## Fields

### Root

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `varp` | string | yes | Varp schema version (e.g. `"0.1.0"`) |
| `name` | string | yes | Project name |
| `docs` | map | no | Project-level docs not scoped to any component |
| `components` | map | yes | Component registry (keys are component names) |

### Component

Each key under `components` is the component name (used in `touches` declarations and dependency references).

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Directory path for this component's source files. Relative paths are resolved from the manifest file's directory. |
| `depends_on` | string[] | no | Names of components this component depends on. Declares structural dependencies — "this component consumes that component's interface." |
| `docs` | DocEntry[] | no | Documentation entries for this component (defaults to `[]`) |

### DocEntry

Used for both component docs and project-level docs.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Unique identifier for this doc within its component |
| `path` | string | yes | File path to the markdown doc. Relative paths resolved from manifest directory. |
| `load_on` | string[] | yes | When to load: `["reads"]`, `["writes"]`, or `["reads", "writes"]` |

### `load_on` Semantics

| Value | Loaded when task... | Typical use |
|-------|---------------------|-------------|
| `["reads"]` | reads from or writes to the component | API surface, behavioral guarantees — what callers need |
| `["writes"]` | writes to the component only | Implementation details, internal algorithms |
| `["reads", "writes"]` | reads from or writes to the component | Always-relevant docs (examples, conventions) |

## Path Resolution

All paths in the manifest (`path`, doc `path`) are resolved relative to the directory containing `varp.yaml`. For example, if `varp.yaml` is at `/project/varp.yaml`, then `./src/auth` resolves to `/project/src/auth`.

The MCP tools perform this resolution at parse time — callers always receive absolute paths in tool responses.

## Project-Level Docs

The optional `docs` field at the manifest root declares docs not scoped to any component. These are included in freshness reports but not loaded by `varp_resolve_docs` (which operates on component touches). Useful for project-wide references like getting-started guides, schema docs, and architecture overviews.

## Dependencies

`depends_on` declares architectural dependencies between components. These are behavioral relationships ("web consumes auth's interface"), not package dependencies.

Dependencies serve three purposes:

1. **Planning** — the planner uses the dependency graph to understand which components interact and to validate `touches` declarations
2. **Invalidation** — when a component's docs change, all components that depend on it are flagged as potentially affected (`varp_invalidation_cascade`)
3. **Validation** — `varp_validate_plan` checks that task write targets are reachable through the dependency graph

The dependency graph must be acyclic. `varp_read_manifest` runs cycle detection at parse time and reports any cycles found.

## Validation

The manifest is validated at parse time by Zod schemas. Validation errors include:

- Missing required fields (`varp`, `name`, `components`, `path`)
- Missing required doc fields (`name`, `path`, `load_on`)
- Invalid `load_on` values (must be `"reads"` or `"writes"`)
- `load_on` must have at least one entry
- Wrong types (e.g. `depends_on` not an array)
- Dependency cycles (detected via Kahn's algorithm)
- References to unknown components in `depends_on`

Use `varp_read_manifest` to parse and validate. The response includes `dependency_graph_valid: true|false` and any detected cycles.

## Minimal Example

The smallest valid manifest:

```yaml
varp: 0.1.0
name: my-app

components:
  core:
    path: ./src
```
