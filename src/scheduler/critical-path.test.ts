import { describe, test, expect } from "bun:test";
import { computeCriticalPath } from "./critical-path.js";
import type { Task } from "../types.js";

function makeTask(
  id: string,
  writes?: string[],
  reads?: string[],
  tokens = 10000,
  minutes = 5,
): Task {
  return {
    id,
    description: `Task ${id}`,
    action: "implement",
    values: ["correctness"],
    touches: { writes, reads },
    budget: { tokens, minutes },
  };
}

describe("computeCriticalPath", () => {
  test("single task", () => {
    const result = computeCriticalPath([makeTask("1", ["auth"])]);
    expect(result.task_ids).toEqual(["1"]);
    expect(result.total_budget).toEqual({ tokens: 10000, minutes: 5 });
  });

  test("linear chain", () => {
    const tasks = [
      makeTask("1", ["auth"], undefined, 10000, 5),
      makeTask("2", ["api"], ["auth"], 20000, 8),
      makeTask("3", undefined, ["api"], 5000, 3),
    ];
    const result = computeCriticalPath(tasks);
    expect(result.task_ids).toEqual(["1", "2", "3"]);
    expect(result.total_budget).toEqual({ tokens: 35000, minutes: 16 });
  });

  test("parallel paths picks longest", () => {
    const tasks = [
      makeTask("1", ["core"]),
      makeTask("2", ["auth"], ["core"]), // path: 1->2 (length 2)
      makeTask("3", ["api"], ["core"]), // path: 1->3->4 (length 3)
      makeTask("4", undefined, ["api"]),
    ];
    const result = computeCriticalPath(tasks);
    expect(result.task_ids).toEqual(["1", "3", "4"]);
  });

  test("empty tasks", () => {
    const result = computeCriticalPath([]);
    expect(result.task_ids).toEqual([]);
    expect(result.total_budget).toEqual({ tokens: 0, minutes: 0 });
  });

  test("no dependencies — single task critical path", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", ["api"])];
    const result = computeCriticalPath(tasks);
    expect(result.task_ids).toHaveLength(1);
  });
});
