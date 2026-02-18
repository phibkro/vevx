import { describe, test, expect } from "bun:test";

import { makeTask } from "#shared/test-helpers.js";

import { computeCriticalPath } from "./critical-path.js";

describe("computeCriticalPath", () => {
  test("single task", () => {
    const result = computeCriticalPath([makeTask("1", ["auth"])]);
    expect(result.task_ids).toEqual(["1"]);
    expect(result.length).toBe(1);
  });

  test("linear chain", () => {
    const tasks = [
      makeTask("1", ["auth"]),
      makeTask("2", ["api"], ["auth"]),
      makeTask("3", undefined, ["api"]),
    ];
    const result = computeCriticalPath(tasks);
    expect(result.task_ids).toEqual(["1", "2", "3"]);
    expect(result.length).toBe(3);
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
    expect(result.length).toBe(3);
  });

  test("empty tasks", () => {
    const result = computeCriticalPath([]);
    expect(result.task_ids).toEqual([]);
    expect(result.length).toBe(0);
  });

  test("no dependencies — single task critical path", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", ["api"])];
    const result = computeCriticalPath(tasks);
    expect(result.task_ids).toHaveLength(1);
    expect(result.length).toBe(1);
  });
});
