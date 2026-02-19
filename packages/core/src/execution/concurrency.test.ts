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
