# Execution Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract `runWithConcurrency` from audit into core's execution layer and define the `TaskResult` schema — completing ADR-002 Step 4.

**Architecture:** The execution layer (`packages/core/src/execution/`) already has chunker + ModelCaller types. We add a generic `TaskResult` schema (the output contract for any executor) and a `runWithConcurrency` utility (the generic worker pool). Audit becomes the first consumer, re-exporting from `@varp/core/lib` instead of owning the implementation.

**Tech Stack:** TypeScript (ESM), Zod (schema-first types), Bun (runtime + test)

---

## Context

### What exists today

| Location                                 | Contains                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/core/src/execution/types.ts`   | `ModelCallerResultSchema`, `ModelCaller` type                                |
| `packages/core/src/execution/chunker.ts` | `FileContentSchema`, `ChunkSchema`, `estimateTokens()`, `createChunks()`     |
| `packages/core/src/shared/types.ts`      | `ExecutionMetricsSchema` (unused producer), `TaskLogSchema` (plan execution) |
| `packages/audit/src/planner/executor.ts` | `runWithConcurrency()` (audit-specific types hardcoded)                      |

### What we're building

1. **`TaskResultSchema`** in `execution/types.ts` — generic task result (status + metrics + artifacts)
2. **`runWithConcurrency()`** in `execution/concurrency.ts` — generic worker pool extracted from audit
3. **Audit migration** — audit re-exports from `@varp/core/lib` instead of owning the worker pool

### What we're NOT building

- Wave dispatcher (stays in plugin skills for now)
- Budget accounting (stays in audit's executor)
- Progress event system (stays audit-specific)
- Strategy selector (deferred per ADR-002)

---

### Task 1: Define TaskResultSchema

**Files:**

- Modify: `packages/core/src/execution/types.ts`
- Test: `packages/core/src/execution/types.test.ts` (create)

**Step 1: Write the failing test**

Create `packages/core/src/execution/types.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";

import { TaskResultSchema } from "./types.js";

describe("TaskResultSchema", () => {
  it("parses a complete result", () => {
    const result = TaskResultSchema.parse({
      status: "COMPLETE",
      metrics: {
        tokens_used: 5000,
        duration_ms: 12000,
      },
      files_modified: ["src/auth/login.ts"],
      observations: ["Refactored login handler to use async/await"],
    });

    expect(result.status).toBe("COMPLETE");
    expect(result.metrics.tokens_used).toBe(5000);
    expect(result.files_modified).toHaveLength(1);
  });

  it("defaults optional fields", () => {
    const result = TaskResultSchema.parse({
      status: "COMPLETE",
    });

    expect(result.files_modified).toEqual([]);
    expect(result.observations).toEqual([]);
    expect(result.metrics).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("accepts all status values", () => {
    for (const status of ["COMPLETE", "PARTIAL", "BLOCKED", "NEEDS_REPLAN"] as const) {
      expect(TaskResultSchema.parse({ status }).status).toBe(status);
    }
  });

  it("captures error on failure statuses", () => {
    const result = TaskResultSchema.parse({
      status: "BLOCKED",
      error: "Missing API credentials",
    });

    expect(result.error).toBe("Missing API credentials");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/execution/types.test.ts`
Expected: FAIL — `TaskResultSchema` is not exported from `./types.js`

**Step 3: Write implementation**

Add to `packages/core/src/execution/types.ts` (after existing `ModelCaller` type):

```typescript
// ── Task Result ──

export const TaskResultMetricsSchema = z.object({
  tokens_used: z.number(),
  duration_ms: z.number(),
  cost_usd: z.number().optional(),
});

export const TaskResultSchema = z.object({
  /** Exit status of the task. */
  status: z.enum(["COMPLETE", "PARTIAL", "BLOCKED", "NEEDS_REPLAN"]),
  /** Resource usage metrics. */
  metrics: TaskResultMetricsSchema.optional(),
  /** Files modified during execution. */
  files_modified: z.array(z.string()).default([]),
  /** Free-text observations from the executor. */
  observations: z.array(z.string()).default([]),
  /** Error message when status is BLOCKED or NEEDS_REPLAN. */
  error: z.string().optional(),
});

export type TaskResultMetrics = z.infer<typeof TaskResultMetricsSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/execution/types.test.ts`
Expected: PASS (4 tests)

**Step 5: Commit**

```bash
git add packages/core/src/execution/types.ts packages/core/src/execution/types.test.ts
git commit -m "feat(execution): add TaskResultSchema for executor output contract"
```

---

### Task 2: Extract runWithConcurrency to core

**Files:**

- Create: `packages/core/src/execution/concurrency.ts`
- Test: `packages/core/src/execution/concurrency.test.ts` (create)

**Step 1: Write the failing test**

Create `packages/core/src/execution/concurrency.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";

import { runWithConcurrency } from "./concurrency.js";

describe("runWithConcurrency", () => {
  it("runs all tasks and returns results", async () => {
    const tasks = [1, 2, 3];
    const results = await runWithConcurrency(tasks, async (n) => n * 10, 2);
    expect(results.sort()).toEqual([10, 20, 30]);
  });

  it("respects concurrency limit", async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = [1, 2, 3, 4, 5];

    await runWithConcurrency(
      tasks,
      async (n) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 10));
        active--;
        return n;
      },
      2,
    );

    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("calls onResult for each completed task", async () => {
    const seen: Array<{ task: number; result: string }> = [];
    const tasks = [1, 2];

    await runWithConcurrency(tasks, async (n) => `r${n}`, 2, {
      onResult: (task, result) => seen.push({ task, result }),
    });

    expect(seen).toHaveLength(2);
  });

  it("calls onError and continues on task failure", async () => {
    const errors: Array<{ task: number; error: Error }> = [];
    const tasks = [1, 2, 3];

    const results = await runWithConcurrency(
      tasks,
      async (n) => {
        if (n === 2) throw new Error("boom");
        return n * 10;
      },
      2,
      { onError: (task, error) => errors.push({ task, error }) },
    );

    expect(results.sort()).toEqual([10, 30]);
    expect(errors).toHaveLength(1);
    expect(errors[0].error.message).toBe("boom");
  });

  it("returns empty array for empty input", async () => {
    const results = await runWithConcurrency([], async (n: number) => n, 5);
    expect(results).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/execution/concurrency.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/core/src/execution/concurrency.ts`:

```typescript
/**
 * Callbacks for monitoring task execution.
 */
export interface ConcurrencyCallbacks<TTask, TResult> {
  onResult?: (task: TTask, result: TResult) => void;
  onError?: (task: TTask, error: Error) => void;
}

/**
 * Run tasks with bounded concurrency using a worker pool pattern.
 *
 * Spawns up to `concurrency` workers that pull from a shared task queue.
 * Results are returned in completion order (not task order).
 * Errors are passed to `onError` and do not stop other workers.
 */
export async function runWithConcurrency<TTask, TResult>(
  tasks: TTask[],
  run: (task: TTask) => Promise<TResult>,
  concurrency: number,
  callbacks?: ConcurrencyCallbacks<TTask, TResult>,
): Promise<TResult[]> {
  if (tasks.length === 0) return [];

  const results: TResult[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const taskIndex = index++;
      const task = tasks[taskIndex];
      try {
        const result = await run(task);
        results.push(result);
        callbacks?.onResult?.(task, result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        callbacks?.onError?.(task, error);
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker());
  await Promise.all(workers);

  return results;
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/execution/concurrency.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add packages/core/src/execution/concurrency.ts packages/core/src/execution/concurrency.test.ts
git commit -m "feat(execution): extract generic runWithConcurrency worker pool"
```

---

### Task 3: Export from lib.ts and update lib.d.ts

**Files:**

- Modify: `packages/core/src/lib.ts`
- Modify: `packages/core/lib.d.ts`

**Step 1: Add exports to lib.ts**

In `packages/core/src/lib.ts`, in the `// Execution` section (after line 85), add:

```typescript
export { runWithConcurrency } from "./execution/concurrency.js";
export type { ConcurrencyCallbacks } from "./execution/concurrency.js";
export { TaskResultSchema, TaskResultMetricsSchema } from "./execution/types.js";
export type { TaskResult, TaskResultMetrics } from "./execution/types.js";
```

**Step 2: Add declarations to lib.d.ts**

In `packages/core/lib.d.ts`, in the execution types section, add after the `ModelCallerResultSchema` declaration:

```typescript
export type TaskResultMetrics = {
  tokens_used: number;
  duration_ms: number;
  cost_usd?: number;
};

export type TaskResult = {
  status: "COMPLETE" | "PARTIAL" | "BLOCKED" | "NEEDS_REPLAN";
  metrics?: TaskResultMetrics;
  files_modified: string[];
  observations: string[];
  error?: string;
};

export declare const TaskResultSchema: ZodType<TaskResult>;
export declare const TaskResultMetricsSchema: ZodType<TaskResultMetrics>;

export interface ConcurrencyCallbacks<TTask, TResult> {
  onResult?: (task: TTask, result: TResult) => void;
  onError?: (task: TTask, error: Error) => void;
}

export function runWithConcurrency<TTask, TResult>(
  tasks: TTask[],
  run: (task: TTask) => Promise<TResult>,
  concurrency: number,
  callbacks?: ConcurrencyCallbacks<TTask, TResult>,
): Promise<TResult[]>;
```

Also add `TaskResult`, `TaskResultMetrics` to the type exports list at the bottom.

**Step 3: Build and verify**

Run: `bunx turbo check`
Expected: 4/4 successful (format + lint + build pass in all packages)

**Step 4: Commit**

```bash
git add packages/core/src/lib.ts packages/core/lib.d.ts
git commit -m "feat(execution): export TaskResult and runWithConcurrency from @varp/core/lib"
```

---

### Task 4: Migrate audit to use core's runWithConcurrency

**Files:**

- Modify: `packages/audit/src/planner/executor.ts`

**Step 1: Replace audit's local runWithConcurrency with core's**

In `packages/audit/src/planner/executor.ts`:

1. Add import at top:

```typescript
import { runWithConcurrency } from "@varp/core/lib";
```

2. Delete the local `runWithConcurrency` function (lines 96–127 approximately).

3. Update all call sites. The signature change is:
   - **Before:** `runWithConcurrency(tasks, run, concurrency, onResult, onError)`
   - **After:** `runWithConcurrency(tasks, run, concurrency, { onResult, onError })`

   There are 2 call sites in `executeAuditPlan()` (Wave 1 and Wave 2). Each passes `onResult` and `onError` as positional args — wrap them in a callbacks object.

**Step 2: Run audit tests**

Run: `bun test packages/audit/`
Expected: All 238 tests pass

**Step 3: Build all packages**

Run: `bunx turbo check`
Expected: 4/4 successful

**Step 4: Commit**

```bash
git add packages/audit/src/planner/executor.ts
git commit -m "refactor(audit): use core's runWithConcurrency instead of local copy"
```

---

### Task 5: Update docs and ADR

**Files:**

- Modify: `packages/core/src/execution/README.md`
- Modify: `docs/decisions/adr-002-three-layer-architecture.md`
- Modify: `packages/core/README.md` (add TaskResult to type reference)

**Step 1: Update execution README**

Add to the Key Exports table in `packages/core/src/execution/README.md`:

| Export                                          | File             | Purpose                                                 |
| ----------------------------------------------- | ---------------- | ------------------------------------------------------- |
| `TaskResultSchema` / `TaskResult`               | `types.ts`       | Executor output: status, metrics, files, observations   |
| `TaskResultMetricsSchema` / `TaskResultMetrics` | `types.ts`       | Resource usage: tokens, duration, cost                  |
| `runWithConcurrency()`                          | `concurrency.ts` | Generic bounded worker pool (shared task queue pattern) |
| `ConcurrencyCallbacks`                          | `concurrency.ts` | Progress callbacks for the worker pool                  |

Update the Consumers section to mention the worker pool.

**Step 2: Mark ADR step 4 as done**

In `docs/decisions/adr-002-three-layer-architecture.md`, change line 116:

```
4. Define `TaskResult` schema and wire it through the execution layer — deferred until executor adapters stabilize
```

to:

```
4. ~~Define `TaskResult` schema and wire it through the execution layer~~ **DONE** — `TaskResultSchema` + `runWithConcurrency()` in `execution/`; audit migrated
```

**Step 3: Update core README**

In `packages/core/README.md`, add `TaskResult` and `runWithConcurrency` to the relevant type/function reference sections.

**Step 4: Commit**

```bash
git add packages/core/src/execution/README.md docs/decisions/adr-002-three-layer-architecture.md packages/core/README.md
git commit -m "docs: mark ADR-002 Step 4 complete, update execution docs"
```

---

### Task 6: Final verification

**Step 1: Run full test suite**

Run: `bunx turbo test`
Expected: All tests pass across all packages

**Step 2: Run lint**

Run: `bunx turbo check`
Expected: 4/4 successful

**Step 3: Run varp lint**

Run: `bun run packages/cli/dist/cli.js lint`
Expected: No new warnings (count should be ~40, same as before)
