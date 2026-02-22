# MCP API Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the Varp MCP server API by adding tool annotations, consolidating related tools, adding outputSchema support, and introducing new composite tools. Reduces tool count from 28 to 23.

**Architecture:** Extend `ToolDef` in the registry to support `annotations` and `outputSchema`. Consolidate 3 tool groups (scheduler 3→1, health 3→1, coupling 3→1) using a `mode` parameter pattern. Add `varp_list_files` for component→file path lookup. All changes are in `packages/mcp/`.

**Tech Stack:** TypeScript, MCP SDK 1.26 (`registerTool` with `annotations` + `outputSchema`), Zod schemas, bun:test

---

### Task 1: Extend ToolDef with annotations and outputSchema

**Files:**

- Modify: `packages/mcp/src/tool-registry.ts`

**Step 1: Read the current file**

Already read. Current `ToolDef` has: `name`, `description`, `inputSchema`, `handler`.

**Step 2: Add annotations and outputSchema to ToolDef type**

```typescript
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

export type ToolDef<T extends ZodRawShape = ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: T;
  outputSchema?: ZodRawShape;
  annotations?: ToolAnnotations;
  handler: (args: z.objectOutputType<T, z.ZodTypeAny>) => Promise<unknown>;
};
```

**Step 3: Pass annotations and outputSchema to registerTool**

Update the `registerTools` function to forward both fields:

```typescript
server.registerTool(
  tool.name,
  {
    description: tool.description,
    inputSchema: tool.inputSchema,
    ...(tool.outputSchema && { outputSchema: tool.outputSchema }),
    ...(tool.annotations && { annotations: tool.annotations }),
  },
  // ... handler unchanged
);
```

**Step 4: Run existing tests to verify no regression**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: All existing tests pass (annotations/outputSchema are optional, so no breakage).

**Step 5: Commit**

```
feat(mcp): extend ToolDef with annotations and outputSchema support
```

---

### Task 2: Add annotations to all existing tools

**Files:**

- Modify: `packages/mcp/src/index.ts`

**Context:** 27 of 28 tools are read-only and idempotent. The one exception is `varp_ack_freshness` which writes to `.varp-freshness.json`.

**Step 1: Define shared annotation objects**

At the top of the tools section, define reusable annotation objects:

```typescript
const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
```

Import `ToolAnnotations` from `@modelcontextprotocol/sdk/types.js`.

**Step 2: Add `annotations` to every tool definition**

- `varp_ack_freshness` → `WRITE`
- All other 27 tools → `READ_ONLY`

**Step 3: Update the "lists all tools" test to verify annotations**

Add a test that checks annotations are present on listed tools:

```typescript
test("all tools have annotations", async () => {
  const result = await client.listTools();
  for (const tool of result.tools) {
    expect(tool.annotations).toBeDefined();
    expect(typeof tool.annotations!.readOnlyHint).toBe("boolean");
    expect(tool.annotations!.destructiveHint).toBe(false);
    expect(tool.annotations!.openWorldHint).toBe(false);
  }
});

test("varp_ack_freshness is not read-only", async () => {
  const result = await client.listTools();
  const ack = result.tools.find((t) => t.name === "varp_ack_freshness")!;
  expect(ack.annotations!.readOnlyHint).toBe(false);
});
```

**Step 4: Run tests**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(mcp): add tool annotations to all 28 tools
```

---

### Task 3: Consolidate scheduler tools into varp_schedule

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/index.test.ts`

**Step 1: Replace the 3 scheduler tool definitions with one**

Remove `varp_compute_waves`, `varp_detect_hazards`, `varp_compute_critical_path`. Add:

```typescript
{
  name: "varp_schedule",
  description:
    "Analyze task scheduling: compute execution waves, detect data hazards (RAW/WAR/WAW/MUTEX), and find the critical path. Use mode='all' (default) for complete analysis.",
  annotations: READ_ONLY,
  inputSchema: {
    ...schedulerTasksInput,
    mode: z
      .enum(["waves", "hazards", "critical_path", "all"])
      .optional()
      .default("all")
      .describe("Analysis mode: waves, hazards, critical_path, or all (default)"),
  },
  handler: async ({ tasks, mode }) => {
    const m = mode ?? "all";
    if (m === "waves") return { waves: computeWaves(tasks) };
    if (m === "hazards") return { hazards: detectHazards(tasks) };
    if (m === "critical_path") return { critical_path: computeCriticalPath(tasks) };
    // all
    const hazards = detectHazards(tasks);
    return {
      waves: computeWaves(tasks),
      hazards,
      critical_path: computeCriticalPath(tasks, hazards),
    };
  },
},
```

**Step 2: Update tests**

Replace the 3 individual scheduler tests with tests for the new unified tool:

```typescript
test("varp_schedule mode=all returns waves, hazards, and critical_path", async () => {
  const result = await client.callTool({
    name: "varp_schedule",
    arguments: { tasks: sampleTasks },
  });
  const data = parseResult(result);
  expect(data.waves).toHaveLength(3);
  expect(data.hazards.filter((h: any) => h.type === "RAW").length).toBeGreaterThanOrEqual(2);
  expect(data.critical_path.task_ids).toEqual(["1", "2", "3"]);
});

test("varp_schedule mode=waves returns only waves", async () => {
  const result = await client.callTool({
    name: "varp_schedule",
    arguments: { tasks: sampleTasks, mode: "waves" },
  });
  const data = parseResult(result);
  expect(data.waves).toHaveLength(3);
  expect(data.hazards).toBeUndefined();
});

test("varp_schedule mode=hazards returns only hazards", async () => {
  const result = await client.callTool({
    name: "varp_schedule",
    arguments: { tasks: sampleTasks, mode: "hazards" },
  });
  const data = parseResult(result);
  expect(data.hazards.length).toBeGreaterThan(0);
  expect(data.waves).toBeUndefined();
});
```

**Step 3: Update the tool list assertion**

Update the sorted tool name list in the "lists all tools" test — remove 3 old names, add `varp_schedule`.

**Step 4: Run tests**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(mcp): consolidate scheduler tools into varp_schedule with mode param
```

---

### Task 4: Consolidate health tools into varp_health

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/index.test.ts`

**Step 1: Replace varp_read_manifest, varp_check_freshness, varp_lint with varp_health**

```typescript
{
  name: "varp_health",
  description:
    "Project health check: parse manifest, check doc freshness, and run lint. Use mode='all' (default) for complete health report. Ideal session-start tool.",
  annotations: READ_ONLY,
  inputSchema: {
    manifest_path: manifestPath,
    mode: z
      .enum(["manifest", "freshness", "lint", "all"])
      .optional()
      .default("all")
      .describe("Check mode: manifest, freshness, lint, or all (default)"),
  },
  handler: async ({ manifest_path, mode }) => {
    const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
    const manifest = parseManifest(mp);
    const m = mode ?? "all";

    if (m === "manifest") {
      const graphResult = validateDependencyGraph(manifest);
      return {
        manifest: {
          manifest,
          dependency_graph_valid: graphResult.valid,
          ...(graphResult.valid ? {} : { cycles: graphResult.cycles }),
        },
      };
    }
    if (m === "freshness") {
      return { freshness: checkFreshness(manifest, dirname(resolve(mp))) };
    }
    if (m === "lint") {
      return { lint: await runLint(manifest, mp) };
    }
    // all
    const graphResult = validateDependencyGraph(manifest);
    return {
      manifest: {
        manifest,
        dependency_graph_valid: graphResult.valid,
        ...(graphResult.valid ? {} : { cycles: graphResult.cycles }),
      },
      freshness: checkFreshness(manifest, dirname(resolve(mp))),
      lint: await runLint(manifest, mp),
    };
  },
},
```

**Step 2: Update tests**

Replace individual manifest/freshness/lint tests:

```typescript
test("varp_health mode=all returns manifest, freshness, and lint", async () => {
  const result = await client.callTool({
    name: "varp_health",
    arguments: { manifest_path: MANIFEST_PATH },
  });
  const data = parseResult(result);
  expect(data.manifest.dependency_graph_valid).toBe(true);
  expect(Object.keys(data.manifest.manifest.components)).toEqual(["auth", "api", "web"]);
  expect(Object.keys(data.freshness.components).sort()).toEqual(["api", "auth", "web"]);
  expect(data.lint).toHaveProperty("total_issues");
  expect(data.lint).toHaveProperty("issues");
});

test("varp_health mode=manifest returns only manifest", async () => {
  const result = await client.callTool({
    name: "varp_health",
    arguments: { manifest_path: MANIFEST_PATH, mode: "manifest" },
  });
  const data = parseResult(result);
  expect(data.manifest.dependency_graph_valid).toBe(true);
  expect(data.freshness).toBeUndefined();
  expect(data.lint).toBeUndefined();
});

test("varp_health mode=freshness returns only freshness", async () => {
  const result = await client.callTool({
    name: "varp_health",
    arguments: { manifest_path: MANIFEST_PATH, mode: "freshness" },
  });
  const data = parseResult(result);
  expect(data.freshness).toBeDefined();
  expect(data.manifest).toBeUndefined();
});

test("varp_health returns error for missing file", async () => {
  const result = await client.callTool({
    name: "varp_health",
    arguments: { manifest_path: "/nonexistent/varp.yaml" },
  });
  expect(result.isError).toBe(true);
});
```

**Step 3: Update tool list assertion** — remove 3, add `varp_health`.

**Step 4: Run tests**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(mcp): consolidate manifest/freshness/lint into varp_health with mode param
```

---

### Task 5: Consolidate coupling tools into varp_coupling

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/index.test.ts`

**Step 1: Replace varp_scan_co_changes, varp_coupling_matrix, varp_coupling_hotspots with varp_coupling**

```typescript
{
  name: "varp_coupling",
  description:
    "Analyze component coupling: scan git co-changes, build structural+behavioral coupling matrix, or find hidden coupling hotspots. Use mode='hotspots' for quick hidden coupling check, mode='all' for full analysis.",
  annotations: READ_ONLY,
  inputSchema: {
    manifest_path: manifestPath,
    mode: z
      .enum(["co_changes", "matrix", "hotspots", "all"])
      .optional()
      .default("all")
      .describe("Analysis mode: co_changes, matrix, hotspots, or all (default)"),
    component: z.string().optional().describe("Filter matrix/hotspots to pairs involving this component"),
    structural_threshold: z
      .number()
      .optional()
      .describe("Manual structural threshold for matrix (default: auto-calibrated)"),
    behavioral_threshold: z
      .number()
      .optional()
      .describe("Manual behavioral threshold for matrix (default: auto-calibrated)"),
    limit: z.number().optional().describe("Max hotspot entries to return (default 20)"),
    max_commit_files: z
      .number()
      .optional()
      .describe("Skip commits touching more than this many files (default 50)"),
    skip_message_patterns: z
      .array(z.string())
      .optional()
      .describe("Skip commits whose subject matches these patterns"),
    exclude_paths: z
      .array(z.string())
      .optional()
      .describe("Glob patterns for files to exclude from co-change analysis"),
  },
  handler: async ({
    manifest_path,
    mode,
    component,
    structural_threshold,
    behavioral_threshold,
    limit,
    max_commit_files,
    skip_message_patterns,
    exclude_paths,
  }) => {
    const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
    const manifestDir = dirname(resolve(mp));
    const m = mode ?? "all";

    // co_changes is the raw data layer
    if (m === "co_changes") {
      const config = {
        ...(max_commit_files !== undefined && { max_commit_files }),
        ...(skip_message_patterns !== undefined && { skip_message_patterns }),
        ...(exclude_paths !== undefined && { exclude_paths }),
      };
      return { co_changes: scanCoChangesWithCache(manifestDir, config) };
    }

    // matrix and hotspots both need manifest + co-change + imports
    const manifest = parseManifest(mp);
    const coChange = scanCoChangesWithCache(manifestDir);
    const imports = scanImports(manifest, manifestDir);
    const matrix = buildCouplingMatrix(coChange, imports, manifest, {
      repo_dir: manifestDir,
      structural_threshold,
      behavioral_threshold,
    });

    if (m === "matrix") {
      if (component) {
        return { matrix: { ...matrix, entries: componentCouplingProfile(matrix, component) } };
      }
      return { matrix };
    }

    if (m === "hotspots") {
      const hotspots = findHiddenCoupling(matrix);
      return { hotspots: hotspots.slice(0, limit ?? 20), total: hotspots.length };
    }

    // all
    const hotspots = findHiddenCoupling(matrix);
    const matrixResult = component
      ? { ...matrix, entries: componentCouplingProfile(matrix, component) }
      : matrix;
    return {
      co_changes: coChange,
      matrix: matrixResult,
      hotspots: hotspots.slice(0, limit ?? 20),
      total_hotspots: hotspots.length,
    };
  },
},
```

**Step 2: Update tests**

The existing test suite likely has no coupling tests (they need git history). Add basic mode-routing tests:

```typescript
test("varp_coupling mode=co_changes returns co-change graph", async () => {
  const result = await client.callTool({
    name: "varp_coupling",
    arguments: { manifest_path: MANIFEST_PATH, mode: "co_changes" },
  });
  const data = parseResult(result);
  expect(data.co_changes).toHaveProperty("edges");
  expect(data.co_changes).toHaveProperty("total_commits_analyzed");
});
```

**Step 3: Update tool list assertion** — remove 3, add `varp_coupling`.

**Step 4: Run tests**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(mcp): consolidate coupling tools into varp_coupling with mode param
```

---

### Task 6: Add varp_list_files tool

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/index.test.ts`

**Step 1: Implement the tool**

Uses `readdirSync` with `{ recursive: true }` to list source files within component paths, same pattern as `imports.ts`:

```typescript
{
  name: "varp_list_files",
  description:
    "List source files for given components or tags. Returns file paths grouped by component. Complements varp_suggest_touches (files→components) with the reverse lookup (components→files).",
  annotations: READ_ONLY,
  inputSchema: {
    manifest_path: manifestPath,
    components: z.array(z.string()).describe("Component names or tags to list files for"),
  },
  handler: async ({ manifest_path, components: rawComponents }) => {
    const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
    const manifest = parseManifest(mp);
    const components = resolveComponentRefs(manifest, rawComponents);
    const files: Array<{ component: string; paths: string[] }> = [];
    let total = 0;
    for (const name of components) {
      const comp = manifest.components[name];
      if (!comp) continue;
      const compFiles: string[] = [];
      for (const compPath of componentPaths(comp)) {
        try {
          const entries = readdirSync(compPath, { withFileTypes: true, recursive: true });
          for (const entry of entries) {
            if (!entry.isFile()) continue;
            compFiles.push(resolve(entry.parentPath ?? compPath, entry.name));
          }
        } catch {}
      }
      files.push({ component: name, paths: compFiles });
      total += compFiles.length;
    }
    return { files, total };
  },
},
```

Add imports at top: `import { readdirSync } from "node:fs"` and `import { resolve } from "node:path"` (resolve may already be imported). Also import `componentPaths` from `@varp/core/lib`.

**Step 2: Add test**

```typescript
test("varp_list_files returns source files for components", async () => {
  const result = await client.callTool({
    name: "varp_list_files",
    arguments: { manifest_path: MANIFEST_PATH, components: ["auth"] },
  });
  const data = parseResult(result);
  expect(data.files).toHaveLength(1);
  expect(data.files[0].component).toBe("auth");
  expect(data.files[0].paths.length).toBeGreaterThan(0);
  expect(typeof data.total).toBe("number");
});
```

**Step 3: Update tool list assertion** — add `varp_list_files`.

**Step 4: Run tests**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(mcp): add varp_list_files tool for component-to-file lookup
```

---

### Task 7: Add outputSchema to tools with stable return shapes

**Files:**

- Modify: `packages/mcp/src/index.ts`
- Modify: `packages/mcp/src/index.test.ts`

**Step 1: Define output schemas for 5 tools**

Add Zod output schemas for tools with simple, stable return shapes:

1. **varp_invalidation_cascade**: `{ affected: z.array(z.string()) }`
2. **varp_check_env**: `{ required: z.array(z.string()), set: z.array(z.string()), missing: z.array(z.string()) }`
3. **varp_list_files**: `{ files: z.array(z.object({ component: z.string(), paths: z.array(z.string()) })), total: z.number() }`
4. **varp_ack_freshness**: `{ acked: z.array(z.string()) }`
5. **varp_verify_capabilities**: `{ valid: z.boolean(), violations: z.array(z.object({ path: z.string(), declared_component: z.string().nullable(), actual_component: z.string() })) }`

Add the `outputSchema` field to each tool definition.

**Step 2: Update the handler return type for outputSchema tools**

When a tool has an `outputSchema`, the SDK expects `structuredContent` in the response. Update the registry to return both `content` (text) and `structuredContent` (typed) when outputSchema is present:

```typescript
// In registerTools:
const result = await tool.handler(args);
if (tool.outputSchema) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result as Record<string, unknown>,
  };
}
return {
  content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
};
```

**Step 3: Add test for outputSchema presence**

```typescript
test("tools with outputSchema are listed with output schema", async () => {
  const result = await client.listTools();
  const withOutput = result.tools.filter((t) => t.outputSchema);
  const names = withOutput.map((t) => t.name).sort();
  expect(names).toEqual([
    "varp_ack_freshness",
    "varp_check_env",
    "varp_invalidation_cascade",
    "varp_list_files",
    "varp_verify_capabilities",
  ]);
});
```

**Step 4: Run tests**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(mcp): add outputSchema to 5 tools with stable return shapes
```

---

### Task 8: Final validation and build

**Files:**

- Build: `packages/mcp/`

**Step 1: Run full test suite**

Run: `bun test packages/mcp/src/index.test.ts`
Expected: All tests pass

**Step 2: Run lint and format**

Run: `cd packages/mcp && bun run check`
Expected: PASS (format + lint + build)

**Step 3: Verify tool count**

The "lists all tools" test should assert exactly 23 tools (alphabetically sorted):

```
varp_ack_freshness
varp_build_codebase_graph
varp_check_env
varp_check_warm_staleness
varp_coupling
varp_derive_restart_strategy
varp_diff_plan
varp_health
varp_infer_imports
varp_invalidation_cascade
varp_list_files
varp_parse_log
varp_parse_plan
varp_render_graph
varp_resolve_docs
varp_scan_links
varp_schedule
varp_scoped_tests
varp_suggest_components
varp_suggest_touches
varp_validate_plan
varp_verify_capabilities
varp_watch_freshness
```

**Step 4: Commit if any fixups needed**

```
chore(mcp): fix lint/format issues
```

---

## Summary

| Task      | What                    | Tools Removed | Tools Added | Net            |
| --------- | ----------------------- | ------------- | ----------- | -------------- |
| 1         | Extend ToolDef type     | 0             | 0           | 0              |
| 2         | Add annotations         | 0             | 0           | 0              |
| 3         | Scheduler consolidation | 3             | 1           | -2             |
| 4         | Health consolidation    | 3             | 1           | -2             |
| 5         | Coupling consolidation  | 3             | 1           | -2             |
| 6         | List files tool         | 0             | 1           | +1             |
| 7         | Output schemas          | 0             | 0           | 0              |
| 8         | Final validation        | 0             | 0           | 0              |
| **Total** |                         | **9**         | **4**       | **-5 (28→23)** |
