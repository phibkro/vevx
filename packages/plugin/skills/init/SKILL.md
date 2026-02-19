---
name: init
description: Scaffold a varp.yaml manifest for an existing project
allowed-tools: mcp__varp__*
---

# /varp:init -- Scaffold Manifest

You are a project structure analyst. Scan an existing JS/TS codebase and generate a `varp.yaml` manifest that maps its components, dependencies, and documentation.

Priority: correctness of component boundaries > dependency accuracy > doc coverage.

## Protocol

### Step 1: Check for Existing Manifest

Check if `varp.yaml` exists in the project root.

- **If it exists:** Call `varp_read_manifest` to display the current structure. Ask the user whether to regenerate from scratch or merge newly discovered components into the existing manifest.
- **If it doesn't exist:** Proceed to Step 2.

### Step 2: Detect Project Structure

Try these strategies in order. Stop at the first one that produces results.

#### Strategy A: Import from monorepo tool graph

If the project uses a monorepo tool with a dependency graph, import it directly — don't re-infer what's already declared.

**Nx** (detected by `nx.json`):
```bash
nx graph --file=/tmp/graph.json
```
Parse the JSON: `graph.nodes` gives component names, paths (`data.root`), and project types. `graph.dependencies` gives typed edges (`static`/`dynamic`/`implicit`). Map each node to a varp component. Map `static` + `implicit` deps to varp `deps`.

**Turborepo** (detected by `turbo.json`):
```bash
turbo query '{ packages { items { name path directDependencies { items { name } } } } }'
```
Parse the JSON: each package becomes a component. `directDependencies` maps to varp `deps`.

**moon** (detected by `.moon/workspace.yml`):
```bash
moon query projects --json
```
Parse the JSON: each project becomes a component. Read each project's `moon.yml` for `dependsOn` entries to populate varp `deps`.

If a tool graph is imported, **skip Step 3** (deps are already known). Proceed to Step 4.

#### Strategy B: Workspace config files

If no monorepo tool graph is available, scan for workspace configuration:

1. **`pnpm-workspace.yaml`** — `packages` array of glob patterns
2. **`package.json`** — `workspaces` field (array of glob patterns)
3. **`tsconfig.json`** — `references` array (TypeScript project references)

Resolve glob patterns to actual directories. Each resolved directory becomes a component. Use the directory basename (or `package.json` `name` field if present) as the component name.

#### Strategy C: Filesystem scanning

If no workspace config found, fall back to filesystem scanning. Use Glob to find directories containing TypeScript or JavaScript source files. Check common patterns: `src/`, `packages/*`, `apps/*`, `lib/*`, and top-level directories with `*.ts` or `*.js` files. Each distinct source directory becomes a component.

After initial scanning, call `varp_suggest_components` with `root_dir` set to the detected source root and `mode: "auto"` to detect both layer-organized projects (files like `user.controller.ts` across `controllers/`, `services/` dirs) and domain-organized projects (domains as top-level dirs with layer subdirs like `src/auth/controllers/`, `src/auth/services/`). Present suggestions to the user for confirmation before generating the manifest.

If suggestions are found, use `varp_render_graph` to visualize the suggested dependency graph before the user confirms.

### Step 3: Infer Dependencies

**Skip this step if deps were imported from a monorepo tool graph in Step 2A.**

For each discovered component, scan its source files (`*.ts`, `*.tsx`, `*.js`, `*.jsx`) for import statements that resolve into another component's directory.

Use Grep to find import/require statements, then check whether the resolved path falls within another component's path boundary. If component A imports from component B's path, add B to A's `deps`.

Only include direct (non-transitive) dependencies. If A imports B and B imports C, A's deps should include B but not C (unless A also imports C directly).

### Step 4: Discover Existing Docs

For each component, check for:

- `{component.path}/README.md` — auto-discovered by varp, no manifest entry needed
- `{component.path}/docs/*.md` — auto-discovered by varp, no manifest entry needed
- Documentation files outside the component's path tree — these require explicit `docs:` entries

Then check for a root-level `docs/` folder. If it exists, scan its files and subfolders for names that match discovered components:

- `docs/{component-name}.md` → add as `docs:` entry for that component
- `docs/{component-name}/` (folder with `.md` files) → add the folder's `.md` files as `docs:` entries

Only match clear name correspondences (exact match or obvious variants like `docs/auth.md` → `auth` component). Skip generic docs that don't map to a specific component (e.g. `docs/getting-started.md`, `docs/contributing.md`).

Note the doc coverage for each component in the summary output.

### Step 5: Generate Manifest

Write `varp.yaml` to the project root with this structure:

```yaml
varp: 0.1.0

component-name:
  path: ./relative/path

another-component:
  path: ./other/path
  deps: [component-name]
```

Rules:
- Version is always `varp: 0.1.0`
- Paths use `./` prefix and are relative to the manifest location
- Only include `deps:` when the component has dependencies
- Only include `docs:` for documentation outside the component's path tree (auto-discovery handles README.md and docs/*.md within the path)
- Component names use lowercase kebab-case derived from directory names
- Optional fields (`tags`, `test`, `env`, `stability`) can be added later — don't include them in the initial scaffold unless the user requests them

Generate the file, then show it to the user for review before validation.

### Step 6: Validate

Call `varp_read_manifest` on the generated file to verify it parses correctly and the dependency graph is acyclic. If parsing fails, fix the issues and retry.

Then call `varp_infer_imports` to cross-check the declared deps against actual import patterns. Report any discrepancies (missing or extra deps) so the user can decide whether to adjust.

If the project has Nx or Turborepo, note their availability for ongoing `touches` validation — the execute skill can use `nx affected` or `turbo query affectedPackages` to advisory-check task scope declarations.

Output a summary:

```
## Manifest Summary

- **Components:** <count>
- **Dependency edges:** <count>
- **Doc coverage:** <components with README.md> / <total components> have interface docs

### Components

| Component | Path | Deps | Has README |
|-----------|------|------|------------|
| ...       | ...  | ...  | yes/no     |

### Import Analysis

- Missing deps (inferred from imports but not declared): ...
- Extra deps (declared but no imports found): ...
```

## Tool Reference

| Tool | Purpose |
|------|---------|
| `varp_read_manifest` | Parse and validate the generated manifest |
| `varp_infer_imports` | Cross-check declared deps against actual import patterns |
| `varp_suggest_components` | Auto-detect component groupings from project structure |
| `varp_render_graph` | Visualize the dependency graph as a Mermaid diagram |
