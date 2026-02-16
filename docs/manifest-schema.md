# Manifest Schema

Reference for `varp.yaml`, the component manifest that declares project structure.

## Example

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

## Format

The manifest has three concepts:

1. **`varp`** — version string (required, top-level key)
2. **Component names** — every other top-level key is a component
3. **Component fields** — `path`, `deps`, `docs`

There is no `name` field, no `components:` wrapper. The YAML is flat: `varp` is the version, everything else is a component.

## Component Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string | yes | Directory path for source files. Relative paths resolved from manifest directory. |
| `deps` | string[] | no | Component names this component depends on. Structural dependencies — "this component consumes that component's interface." |
| `docs` | string[] | no | File paths to documentation (defaults to `[]`). Relative paths resolved from manifest directory. |

## README.md Convention

Doc visibility is determined by filename, not metadata:

| Filename | Visibility | Loaded when... |
|----------|-----------|----------------|
| `README.md` | Public | Task reads from OR writes to the component |
| Any other `.md` | Private | Task writes to the component only |

This replaces the old `load_on` tag system. Name your public-facing docs `README.md` and they load automatically for consumers.

## Auto-Discovery

If `{component.path}/README.md` exists on disk, it is automatically included as a public doc even if not listed in `docs`. This means a component with `path: ./src/auth` automatically gets `./src/auth/README.md` as a public doc if that file exists.

## Path Resolution

All paths (`path`, doc entries) are resolved relative to the directory containing `varp.yaml`. For example, if `varp.yaml` is at `/project/varp.yaml`, then `./src/auth` resolves to `/project/src/auth`.

The MCP tools perform this resolution at parse time — callers always receive absolute paths in tool responses.

## Dependencies

`deps` declares architectural dependencies between components. These are behavioral relationships ("web consumes auth's interface"), not package dependencies.

Dependencies serve three purposes:

1. **Planning** — the planner uses the dependency graph to understand which components interact and to validate `touches` declarations
2. **Invalidation** — when a component's docs change, all components that depend on it are flagged as potentially affected (`varp_invalidation_cascade`)
3. **Validation** — `varp_validate_plan` checks that task write targets are reachable through the dependency graph

The dependency graph must be acyclic. `varp_read_manifest` runs cycle detection at parse time and reports any cycles found.

## Validation

The manifest is validated at parse time by Zod schemas. Validation errors include:

- Missing `varp` key
- Wrong types (e.g. `deps` not an array, `docs` not an array of strings)
- Dependency cycles (detected via Kahn's algorithm)
- References to unknown components in `deps`

Use `varp_read_manifest` to parse and validate. The response includes `dependency_graph_valid: true|false` and any detected cycles.

## Minimal Example

The smallest valid manifest:

```yaml
varp: 0.1.0

core:
  path: ./src
```
