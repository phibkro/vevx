# Three-Layer Refactor Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the three-layer architecture (Analysis / Scheduler / Execution) from ADR-002 explicit through interface schemas and type narrowing.

**Architecture:** Define `TaskDefinitionSchema` and `CodebaseGraphSchema` as Zod schemas in `shared/types.ts`. Narrow `WaveSchema.tasks` from `Task[]` to `TaskDefinition[]`. Replace file-local `Pick<Task, ...>` types in scheduler modules with the shared `TaskDefinition`. Update MCP handlers, lib exports, and hand-maintained `.d.ts`.

**Tech Stack:** TypeScript, Zod, Bun (test/build), MCP SDK

---

### Task 1: Add `TaskDefinitionSchema` to shared types

**Files:**
- Modify: `packages/core/src/shared/types.ts:127-148` (Scheduler section)

**Step 1: Add the schema and type**

Insert after the `// ── Scheduler ──` comment (line 127), before `WaveSchema`:

```typescript
export const TaskDefinitionSchema = z.object({
  id: z.string(),
  touches: TouchesSchema,
  mutexes: z.array(z.string()).optional(),
});

export type TaskDefinition = z.infer<typeof TaskDefinitionSchema>;
```

**Step 2: Narrow `WaveSchema.tasks` from `TaskSchema` to `TaskDefinitionSchema`**

Change line 131 from:

```typescript
export const WaveSchema = z.object({
  id: z.number(),
  tasks: z.array(TaskSchema),
});
```

to:

```typescript
export const WaveSchema = z.object({
  id: z.number(),
  tasks: z.array(TaskDefinitionSchema),
});
```

**Step 3: Run scheduler tests to check for breakage**

Run: `bun test packages/core/src/scheduler/`

Expected: Tests may fail because `makeTask()` returns full `Task` objects which are now wider than `TaskDefinition`. Zod parsing would strip extra fields, but TypeScript structural typing means `Task` is assignable to `TaskDefinition` — so tests should still pass. The key question is whether any test reads `wave.tasks[i].action` or `wave.tasks[i].description` from wave output.

Check: `waves.test.ts` only reads `.id` and `.touches` from wave tasks — no access to `action`/`values`/`description`. Tests should pass.

**Step 4: Commit**

```
feat(shared): add TaskDefinitionSchema and narrow WaveSchema

Introduces TaskDefinition as the scheduler's input contract (id, touches,
mutexes). Narrows Wave.tasks from Task[] to TaskDefinition[] — the
scheduler never sees execution intent (action, values, description).
```

---

### Task 2: Add `CodebaseGraphSchema` to shared types

**Files:**
- Modify: `packages/core/src/shared/types.ts` (after the Co-Change Analysis section, ~line 286)

**Step 1: Add the schema and type**

Insert after the co-change type exports (line 285), before `// ── Validation ──`:

```typescript
// ── Codebase Graph ──

export const CodebaseGraphSchema = z.object({
  manifest: ManifestSchema,
  coChange: CoChangeGraphSchema,
  imports: ImportScanResultSchema,
  coupling: CouplingMatrixSchema.optional(),
});

export type CodebaseGraph = z.infer<typeof CodebaseGraphSchema>;
```

**Step 2: Run build to verify**

Run: `bun run build` in `packages/core/`

Expected: PASS — this is purely additive.

**Step 3: Commit**

```
feat(shared): add CodebaseGraphSchema as analysis layer contract

Composition of existing types (Manifest, CoChangeGraph, ImportScanResult,
CouplingMatrix?) — the analysis layer's unified output for consumers.
```

---

### Task 3: Update scheduler modules to use `TaskDefinition`

**Files:**
- Modify: `packages/core/src/scheduler/hazards.ts:1-3`
- Modify: `packages/core/src/scheduler/waves.ts:1-6`
- Modify: `packages/core/src/scheduler/critical-path.ts:1-5`

**Step 1: Update `hazards.ts`**

Replace lines 1-3:

```typescript
import type { Task, Hazard } from "#shared/types.js";

type TaskRef = Pick<Task, "id" | "touches"> & { mutexes?: string[] };
```

with:

```typescript
import type { TaskDefinition, Hazard } from "#shared/types.js";
```

Replace `TaskRef` with `TaskDefinition` in the function signature (line 11):

```typescript
export function detectHazards(tasks: TaskDefinition[]): Hazard[] {
```

**Step 2: Update `waves.ts`**

Replace lines 1-6:

```typescript
import type { Task, Wave } from "#shared/types.js";

import { computeCriticalPath } from "./critical-path.js";
import { detectHazards } from "./hazards.js";

type SchedulableTask = Pick<Task, "id" | "touches"> & { mutexes?: string[] };
```

with:

```typescript
import type { TaskDefinition, Wave } from "#shared/types.js";

import { computeCriticalPath } from "./critical-path.js";
import { detectHazards } from "./hazards.js";
```

Replace `SchedulableTask` with `TaskDefinition` in:
- Function signature (line 15): `export function computeWaves(tasks: TaskDefinition[]): Wave[]`
- Map type (line 64): `const waveGroups = new Map<number, TaskDefinition[]>()`

Remove the `as Task[]` cast on line 86. After narrowing `WaveSchema.tasks` to `TaskDefinitionSchema`, the types align without casting:

```typescript
    waves.push({ id: waveId, tasks: waveTasks });
```

**Step 3: Update `critical-path.ts`**

Replace lines 1-5:

```typescript
import type { Task, Hazard, CriticalPath } from "#shared/types.js";

import { detectHazards } from "./hazards.js";

type SchedulableTask = Pick<Task, "id" | "touches">;
```

with:

```typescript
import type { TaskDefinition, Hazard, CriticalPath } from "#shared/types.js";

import { detectHazards } from "./hazards.js";
```

Replace `SchedulableTask` with `TaskDefinition` in the function signature (line 11):

```typescript
export function computeCriticalPath(tasks: TaskDefinition[], hazards?: Hazard[]): CriticalPath {
```

**Step 4: Run scheduler tests**

Run: `bun test packages/core/src/scheduler/`

Expected: PASS — `makeTask()` returns `Task` which is structurally assignable to `TaskDefinition` (it has all the required fields plus extras that TypeScript ignores).

**Step 5: Commit**

```
refactor(scheduler): replace file-local Pick types with TaskDefinition

The scheduler now imports TaskDefinition from shared types instead of
defining equivalent Pick<Task, ...> types locally. Removes the as Task[]
cast in computeWaves — Wave.tasks is now TaskDefinition[], no cast needed.
```

---

### Task 4: Add `makeTaskDef` test helper

**Files:**
- Modify: `packages/core/src/shared/test-helpers.ts`

**Step 1: Add the helper**

Add after the existing `makePlan` function:

```typescript
/**
 * Create a TaskDefinition (scheduler-only shape). Use in scheduler tests
 * that don't need execution fields (action, values, description).
 */
export function makeTaskDef(
  id: string,
  writes?: string[],
  reads?: string[],
  mutexes?: string[],
): TaskDefinition {
  return {
    id,
    touches: { writes, reads },
    ...(mutexes ? { mutexes } : {}),
  };
}
```

Update the import at the top to include `TaskDefinition`:

```typescript
import type { Task, Plan, TaskDefinition } from "./types.js";
```

**Step 2: Commit**

```
feat(shared): add makeTaskDef test helper for scheduler tests
```

Note: Existing tests can continue using `makeTask()` — the wider `Task` type is assignable to `TaskDefinition`. The new helper is for clarity in future tests and optional migration.

---

### Task 5: Update MCP tool handlers

**Files:**
- Modify: `packages/mcp/src/index.ts:44-66` (shared schemas)
- Modify: `packages/mcp/src/index.ts:159-189` (tool handlers)

**Step 1: Replace local schemas with `TaskDefinitionSchema` import**

Add `TaskDefinitionSchema` to the import from `@varp/core/lib` (line 38-39):

```typescript
  TouchesSchema,
  TaskDefinitionSchema,
} from "@varp/core/lib";
```

Remove the local `taskRefSchema` and `schedulableTaskSchema` definitions (lines 52-58):

```typescript
// DELETE these lines:
const taskRefSchema = z.object({ id: z.string(), touches: TouchesSchema, mutexes: mutexesSchema });

const schedulableTaskSchema = z.object({
  id: z.string(),
  touches: TouchesSchema,
  mutexes: mutexesSchema,
});
```

Also remove the now-unused `mutexesSchema` (line 50).

Replace the input schema references (lines 60-66):

```typescript
const schedulerTasksInput = {
  tasks: z.array(TaskDefinitionSchema).describe("Tasks with touches declarations"),
};
```

Remove the separate `hazardTasksInput` — it was identical to `schedulerTasksInput` and can be consolidated. Update `varp_detect_hazards` to use `schedulerTasksInput`.

**Step 2: Update `varp_validate_plan` handler**

The handler on line 163 passes `plan.tasks` (full `Task[]`) to `detectHazards`. Since `Task` is structurally compatible with `TaskDefinition`, this still works — but for clarity, extract the scheduling-relevant subset:

```typescript
handler: async ({ plan_path, manifest_path }) => {
  const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
  const plan = parsePlanFile(plan_path);
  const manifest = parseManifest(mp);
  const taskDefs = plan.tasks.map(({ id, touches, mutexes }) => ({ id, touches, mutexes }));
  const hazards = detectHazards(taskDefs);
  const { import_deps } = scanImports(manifest, dirname(resolve(mp)));
  return validatePlan(plan, manifest, hazards, import_deps);
},
```

**Step 3: Run MCP integration tests**

Run: `bun test packages/core/src/index.test.ts`

Expected: PASS

**Step 4: Commit**

```
refactor(mcp): use TaskDefinitionSchema for scheduler tool inputs

Replaces local taskRefSchema/schedulableTaskSchema with the shared
TaskDefinitionSchema. Extracts TaskDefinition subset in validate_plan
handler to make the layer boundary explicit.
```

---

### Task 6: Update `lib.ts` exports

**Files:**
- Modify: `packages/core/src/lib.ts:10,64-114`

**Step 1: Export new schemas**

Add `TaskDefinitionSchema` and `CodebaseGraphSchema` to the schema export on line 10:

```typescript
export { componentPaths, TouchesSchema, TaskDefinitionSchema, CodebaseGraphSchema } from "./shared/types.js";
```

Add the new types to the type re-exports block (after line 98):

```typescript
  TaskDefinition,
  CodebaseGraph,
```

**Step 2: Run build**

Run: `bun run build` in `packages/core/`

Expected: PASS

**Step 3: Commit**

```
feat(lib): export TaskDefinition and CodebaseGraph schemas and types
```

---

### Task 7: Update hand-maintained `lib.d.ts`

**Files:**
- Modify: `packages/core/lib.d.ts`

**Step 1: Add `TaskDefinition` type**

Add near the existing scheduler types (around line 313):

```typescript
export type TaskDefinition = {
  id: string;
  touches: Touches;
  mutexes?: string[];
};
```

**Step 2: Update `Wave` type**

Change from:

```typescript
export type Wave = {
  id: number;
  tasks: Plan["tasks"];
};
```

to:

```typescript
export type Wave = {
  id: number;
  tasks: TaskDefinition[];
};
```

**Step 3: Add `CodebaseGraph` type**

Add after the coupling types:

```typescript
export type CodebaseGraph = {
  manifest: Manifest;
  coChange: CoChangeGraph;
  imports: ImportScanResult;
  coupling?: CouplingMatrix;
};
```

**Step 4: Update scheduler function signatures**

Update the declarations (around line 471-480):

```typescript
export function detectHazards(tasks: TaskDefinition[]): Hazard[];
export function computeWaves(tasks: TaskDefinition[]): Wave[];
export function computeCriticalPath(tasks: TaskDefinition[], hazards?: Hazard[]): CriticalPath;
```

**Step 5: Export the schemas**

Add to the schema exports section:

```typescript
export declare const TaskDefinitionSchema: ZodType<TaskDefinition>;
export declare const CodebaseGraphSchema: ZodType<CodebaseGraph>;
```

**Step 6: Run full build to verify**

Run: `turbo build`

Expected: PASS — `@varp/cli` and `@varp/audit` both import from `@varp/core/lib`, so the build validates the `.d.ts` against their usage.

**Step 7: Commit**

```
docs(lib.d.ts): update declarations for TaskDefinition and CodebaseGraph
```

---

### Task 8: Final verification

**Step 1: Run full check**

Run: `turbo check`

Expected: PASS (format + lint + build across all packages)

**Step 2: Run all tests**

Run: `turbo test`

Expected: PASS

**Step 3: Run MCP integration tests specifically**

Run: `bun test packages/core/src/index.test.ts`

Expected: PASS

**Step 4: Verify CLI still works**

Run: `turbo build && bun run packages/cli/dist/cli.js --help`

Expected: Shows available commands including `coupling`

**Step 5: Commit (if any formatting fixups needed)**

```
chore: format fixups from three-layer refactor
```
