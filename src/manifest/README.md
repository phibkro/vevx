# Manifest Schema

Reference for `varp.yaml`, the component manifest that declares project structure.

## Example

```yaml
varp: 0.1.0

auth:
  path: ./src/auth
  tags: [security, api-boundary]
  stability: stable

api:
  path: ./src/api
  deps: [auth]
  env: [DATABASE_URL]
  test: "bun test src/api --timeout 5000"

web:
  path: ./src/web
  deps: [auth, api]
  stability: active
  docs:
    - ./docs/shared/migration-guide.md  # only needed for docs outside component path
```

### Multi-Path Components

Components can span multiple directories. Use an array of paths when a domain concept is organized by architectural layer rather than by feature:

```yaml
auth:
  path:
    - ./src/controllers/auth
    - ./src/services/auth
    - ./src/repositories/auth
  deps: [shared]
```

All manifest operations (ownership lookup, doc discovery, import scanning, test discovery, freshness checking) work across all paths of a multi-path component. A single string path is equivalent to a one-element array.

## Format

The manifest has three concepts:

1. **`varp`** — version string (required, top-level key)
2. **Component names** — every other top-level key is a component
3. **Component fields** — `path`, `deps`, `docs`

There is no `name` field, no `components:` wrapper. The YAML is flat: `varp` is the version, everything else is a component.

## Component Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `path` | string \| string[] | yes | Directory path(s) for source files. A single string or array of strings. Relative paths resolved from manifest directory. |
| `deps` | string[] | no | Component names this component depends on. Structural dependencies — "this component consumes that component's interface." |
| `docs` | string[] | no | Additional doc paths beyond auto-discovered ones (defaults to `[]`). Only needed for docs outside the component's path. Relative paths resolved from manifest directory. |
| `tags` | string[] | no | Freeform labels for filtering and grouping (e.g. `[security, api-boundary]`). |
| `test` | string | no | Custom test command. When set, `varp_scoped_tests` uses this instead of auto-discovering `*.test.ts` files. |
| `env` | string[] | no | Environment variables the component requires at runtime (e.g. `[DATABASE_URL]`). Informational — not enforced. |
| `stability` | `"stable"` \| `"active"` \| `"experimental"` | no | Component maturity level. Helps the planner gauge change risk. |

## README.md Convention

Doc visibility is determined by filename, not metadata:

| Filename | Visibility | Loaded when... |
|----------|-----------|----------------|
| `README.md` | Public | Task reads from OR writes to the component |
| Any other `.md` | Private | Task writes to the component only |

This replaces the old `load_on` tag system. Name your public-facing docs `README.md` and they load automatically for consumers.

## Auto-Discovery

Two locations are auto-discovered per component path without needing to be listed in `docs`:

| Path | Visibility | Description |
|------|-----------|-------------|
| `{path}/README.md` | Public | Component interface doc, loaded for reads and writes |
| `{path}/docs/*.md` | Private | Internal docs, loaded for writes only |

This means a component with `path: ./src/auth` automatically gets:
- `./src/auth/README.md` as a public doc (if it exists)
- `./src/auth/docs/*.md` files as private docs (if the directory exists)

For multi-path components, auto-discovery runs for each path. A component with `path: [./src/controllers/auth, ./src/services/auth]` discovers READMEs and `docs/` directories under both paths.

The `docs:` field is only needed for documentation files that live outside the component's path tree.

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

## Linting

`varp_lint` runs all manifest health checks in a single pass and returns a unified report:

- **Import deps** — scans source files for static imports (including tsconfig `paths` aliases like `#shared/*`, follows `extends` chains), flags undeclared dependencies (error) and unused declared dependencies (warning). Warnings are suppressed for components with no source files (e.g. prompt-only or shell-script components).
- **Link integrity** — scans component docs for markdown links, flags broken links (error) and undeclared link-inferred dependencies (warning)
- **Doc freshness** — compares doc mtimes against source file mtimes (excluding doc files from the source scan), flags stale docs (warning). A 5-second tolerance threshold eliminates false positives from batch edits where source and docs are updated within seconds of each other.
- **Stability** — warns when a `stable` component has no explicit `test` command (relies on auto-discovery) and when an `experimental` component is depended on by a `stable` component

Each issue includes a `severity` (`error` | `warning`), `category` (`imports` | `links` | `freshness` | `stability`), `message`, and optional `component` name. The pure `lint()` function accepts pre-computed `ImportScanResult`, `LinkScanResult`, and `FreshnessReport` — no I/O, fully testable with synthetic data. The `runLint()` wrapper performs the scans and delegates to `lint()`.

## Scoped Tests

`varp_scoped_tests` finds `*.test.ts` files under the component paths referenced by a `touches` declaration. Write components are always included; read components are included only when `include_read_tests` is true (default false). When `tags` is provided, only components whose `tags` intersect with the filter are processed (components without tags are excluded). Collects `env` fields from all covered components into `required_env` (deduplicated, sorted). Returns absolute paths, covered component names, a ready-to-run `bun test` command with relative paths, and required environment variables.

## Suggest Components

`varp_suggest_components` helps bootstrap a manifest for layer-organized or domain-organized codebases. Three detection modes:

- **layers** — Scans for conventional layer directories (`controllers`, `services`, etc.) at root. Extracts name stems (`.controller.ts` → `user`), groups stems appearing in 2+ layers into multi-path components.
- **domains** — Scans for top-level directories containing 2+ layer subdirectories (e.g. `auth/controllers/`, `auth/services/`). Each domain directory becomes a component with multi-path entries.
- **auto** (default) — Runs both modes and merges, deduplicating by name (layer results take priority).

Use the output to scaffold `varp.yaml` components with `path: [...]` arrays.

## Render Graph

`varp_render_graph` generates Mermaid diagram syntax from the manifest dependency graph. Nodes are annotated with stability badges when set. Useful for visualizing project structure during init or status reporting.

## Watch Freshness

`varp_watch_freshness` wraps `varp_check_freshness` with timestamp-based filtering. On first call (no `since`), returns all stale docs as the initial snapshot. On subsequent calls, pass the previous `snapshot_time` as `since` to get only changes since the baseline. Returns `total_stale` count for quick polling.

## Minimal Example

The smallest valid manifest:

```yaml
varp: 0.1.0

core:
  path: ./src
```
