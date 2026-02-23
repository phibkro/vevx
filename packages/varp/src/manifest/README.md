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
    - ./docs/shared/migration-guide.md # only needed for docs outside component path
```

### Multi-Path Components

Components can span multiple directories. Use `paths` (array) when a domain concept is organized by architectural layer rather than by feature:

```yaml
auth:
  paths:
    - ./src/controllers/auth
    - ./src/services/auth
    - ./src/repositories/auth
  deps: [shared]
```

`path` and `paths` can coexist on the same component — they merge:

```yaml
auth:
  path: ./src/controllers/auth
  paths:
    - ./src/services/auth
    - ./src/repositories/auth
```

All manifest operations (ownership lookup, doc discovery, import scanning, test discovery, freshness checking) work across all paths of a multi-path component.

## Format

The manifest has three concepts:

1. **`varp`** — version string (required, top-level key)
2. **Component names** — every other top-level key is a component
3. **Component fields** — `path`, `deps`, `docs`

There is no `name` field, no `components:` wrapper. The YAML is flat: `varp` is the version, everything else is a component.

## Component Fields

| Field       | Type                                         | Required         | Description                                                                                                                                                                                              |
| ----------- | -------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`      | string                                       | yes (or `paths`) | Single directory path for source files. Relative path resolved from manifest directory.                                                                                                                  |
| `paths`     | string[]                                     | yes (or `path`)  | Multiple directory paths for source files. Use when a component spans multiple directories. Can coexist with `path` (they merge).                                                                        |
| `deps`      | string[]                                     | no               | Component names or tags this component depends on. A tag entry expands to all components with that tag (excluding self). Structural dependencies — "this component consumes that component's interface." |
| `docs`      | string[]                                     | no               | Additional doc paths beyond auto-discovered ones (defaults to `[]`). Only needed for docs outside the component's path. Relative paths resolved from manifest directory.                                 |
| `tags`      | string[]                                     | no               | Labels for grouping — usable in `deps` and MCP tool parameters as non-terminals that expand to all tagged components (e.g. `[core, security]`).                                                          |
| `test`      | string                                       | no               | Custom test command. When set, `varp_scoped_tests` uses this instead of auto-discovering `*.test.ts` files.                                                                                              |
| `env`       | string[]                                     | no               | Environment variables the component requires at runtime (e.g. `[DATABASE_URL]`). Informational — not enforced.                                                                                           |
| `stability` | `"stable"` \| `"active"` \| `"experimental"` | no               | Component maturity level. Helps the planner gauge change risk.                                                                                                                                           |

## README.md Convention

Doc visibility is determined by filename, not metadata:

| Filename        | Visibility | Loaded when...                             |
| --------------- | ---------- | ------------------------------------------ |
| `README.md`     | Public     | Task reads from OR writes to the component |
| Any other `.md` | Private    | Task writes to the component only          |

This replaces the old `load_on` tag system. Name your public-facing docs `README.md` and they load automatically for consumers.

## Auto-Discovery

Two locations are auto-discovered per component path without needing to be listed in `docs`:

| Path               | Visibility | Description                                          |
| ------------------ | ---------- | ---------------------------------------------------- |
| `{path}/README.md` | Public     | Component interface doc, loaded for reads and writes |
| `{path}/docs/*.md` | Private    | Internal docs, loaded for writes only                |

This means a component with `path: ./src/auth` automatically gets:

- `./src/auth/README.md` as a public doc (if it exists)
- `./src/auth/docs/*.md` files as private docs (if the directory exists)

For multi-path components, auto-discovery runs for each path. A component with multiple `paths` discovers READMEs and `docs/` directories under all paths.

The `docs:` field is only needed for documentation files that live outside the component's path tree.

## Path Resolution

All paths (`path`, doc entries) are resolved relative to the directory containing `varp.yaml`. For example, if `varp.yaml` is at `/project/varp.yaml`, then `./src/auth` resolves to `/project/src/auth`.

The MCP tools perform this resolution at parse time — callers always receive absolute paths in tool responses.

## Dependencies

`deps` declares architectural dependencies between components. These are behavioral relationships ("web consumes auth's interface"), not package dependencies. Each entry can be a component name or a tag:

- **Component name** (exact match) — depends on that specific component
- **Tag** — expands to all components with that tag (excluding self). If a component name and tag share the same name, the component name wins.

Tag expansion happens at parse time — downstream tools always see resolved component names. The same expansion applies to MCP tool parameters that accept component names (`reads`, `writes`, `components`, `changed`) via `resolveComponentRefs`. See `docs/tag-expansion-design.md` for the full design.

```yaml
# Instead of enumerating every core component:
cli:
  path: ./packages/cli/src
  deps: [core] # expands to all components tagged "core"
```

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
- References to unknown components or tags in `deps`

Use `varp_read_manifest` to parse and validate. The response includes `dependency_graph_valid: true|false` and any detected cycles.

## Linting

`varp_lint` runs all manifest health checks in a single pass and returns a unified report:

- **Import deps** — scans source files for static imports (including tsconfig `paths` aliases like `#shared/*`, follows `extends` chains). When an import resolves to a file outside all component directories (e.g. a barrel like `lib.ts`), the scanner expands its re-exports one level to discover the actual component dependencies. Flags undeclared dependencies (error).
- **Link integrity** — scans component docs for markdown links, flags broken links (error) and undeclared link-inferred dependencies (warning).
- **Unused deps** (composed) — a declared dependency is only warned as unused when _both_ import scanning and link scanning agree it's extra. If either signal justifies the dep, no warning. This eliminates noise from deps that are structurally real but only evidenced by one signal. Category: `deps`.
- **Doc freshness** — compares doc mtimes against source file mtimes (excluding doc files and test files from the source scan), flags stale docs (warning). A 5-second tolerance threshold eliminates false positives from batch edits where source and docs are updated within seconds of each other. Freshness acks (via `varp_ack_freshness`) are also considered — if a doc was acknowledged more recently than the source change, it is not flagged stale.
- **Stability** — warns when a `stable` component has no explicit `test` command (relies on auto-discovery) and when an `experimental` component is depended on by a `stable` component.

Each issue includes a `severity` (`error` | `warning`), `category` (`imports` | `links` | `deps` | `freshness` | `stability`), `message`, and optional `component` name. The pure `lint()` function accepts pre-computed `ImportScanResult`, `LinkScanResult`, `FreshnessReport`, and optional `LintSuppressions` — no I/O, fully testable with synthetic data. The `runLint()` wrapper performs the scans, loads suppressions from `.varp/lint-suppressions.json`, and delegates to `lint()`.

### Suppressions

Warnings can be suppressed via `varp lint --suppress`, which writes issue keys to `.varp/lint-suppressions.json`. Suppressed warnings are filtered from future lint runs. Only warnings are suppressible — errors always surface. The suppressions file can be committed (team-wide) or gitignored (per-developer). To reset, delete the file.

## Scoped Tests

`varp_scoped_tests` finds `*.test.ts` files under the component paths referenced by a `touches` declaration. Write components are always included; read components are included only when `include_read_tests` is true (default false). When `tags` is provided, only components whose `tags` intersect with the filter are processed (components without tags are excluded). Collects `env` fields from all covered components into `required_env` (deduplicated, sorted). Returns absolute paths, covered component names, a ready-to-run `bun test` command with relative paths, and required environment variables.

## Suggest Components

`varp_suggest_components` helps bootstrap a manifest by detecting components from project structure. In **auto** mode (default), five strategies run in priority order, deduplicating by name:

1. **Workspace packages** (highest confidence) — Parses `package.json` `workspaces` field, one component per package.
2. **Container dirs** — Scans `packages/`, `apps/`, `modules/`, `libs/` for subdirectories with source files.
3. **Indicator dirs** — Directories containing `src/`, `app/`, `lib/`, `test/`, `tests/`, or `node_modules/` are treated as components.
4. **Layers** — Scans layer directories (controllers, services, etc.) for files with common name stems across 2+ layers.
5. **Domains** — Scans for domain directories containing 2+ layer subdirectories (e.g. `auth/controllers/`, `auth/services/`).

Detection conventions are defined in `DEFAULT_DETECTION_CONFIG` (inspectable via `varp conventions`). Use the output to scaffold `varp.yaml` components with `paths: [...]` arrays.

## Render Graph

`varp_render_graph` renders the manifest dependency graph in two formats:

- **Mermaid** (default): Diagram syntax with emoji stability badges (🟢🟡🔴). Used by skills for rich output.
- **ASCII**: Terminal-friendly tree layout with stability badges (`·`, `·▲`, `·⚠`) and tag markers. Tags display as colored dots (ANSI), superscript numbers (`¹²³`), or a group-by-tag view. Useful for quick terminal inspection via `varp graph`.

`renderAsciiGraph` accepts `AsciiGraphOptions` to independently toggle stability badges and tag display mode. `renderTagGroups` provides an inverted view grouping components by tag.

## Warm Staleness

`varp_check_warm_staleness` checks whether components have been modified since a warm agent was last dispatched. For each requested component, it gets the latest source file mtime (excluding doc files, same exclusion set as freshness) and compares against the baseline timestamp. Components whose source was modified after the baseline are reported as stale. Returns `safe_to_resume`, the list of stale components, and a human-readable `summary` suitable for injection into a resumed agent's prompt.

## Ack Freshness

`varp_ack_freshness` records that component docs have been reviewed and are still accurate, without modifying the doc files themselves. This eliminates false-positive staleness warnings after internal refactors that don't change documented behavior.

Acks are stored in `.varp/freshness.json` in the manifest directory — a sidecar file mapping absolute doc paths to ISO timestamps. When checking freshness, the effective time for each doc is `max(doc_mtime, ack_time)`. If the effective time is within the staleness threshold of the source mtime, the doc is considered fresh.

**Parameters:** `{ manifest_path?: string, components: string[], doc?: string }`

- `components` — component names or tags whose docs to acknowledge
- `doc` — optional doc key (e.g. `"README"`) to ack a specific doc; omit to ack all docs for the listed components

**Returns:** `{ acked: string[] }` — absolute paths of acknowledged docs

The `.varp/freshness.json` file can be committed (team-wide acks) or gitignored (per-developer). Acks expire naturally — when source files change after the ack timestamp, the doc becomes stale again.

## Watch Freshness

`varp_watch_freshness` wraps `varp_check_freshness` with timestamp-based filtering. On first call (no `since`), returns all stale docs as the initial snapshot. On subsequent calls, pass the previous `snapshot_time` as `since` to get only changes since the baseline. Returns `total_stale` count for quick polling.

## Minimal Example

The smallest valid manifest:

```yaml
varp: 0.1.0

core:
  path: ./src
```
