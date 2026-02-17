import { describe, test, expect } from "bun:test";

import { makeTask } from "../test-helpers.js";
import { computeWaves } from "./waves.js";

describe("computeWaves", () => {
  test("independent tasks in single wave", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", ["api"])];
    const waves = computeWaves(tasks);
    expect(waves).toHaveLength(1);
    expect(waves[0].tasks).toHaveLength(2);
  });

  test("RAW dependency creates sequential waves", () => {
    const tasks = [
      makeTask("1", ["auth"]), // writes auth
      makeTask("2", undefined, ["auth"]), // reads auth — depends on 1
    ];
    const waves = computeWaves(tasks);
    expect(waves).toHaveLength(2);
    expect(waves[0].tasks[0].id).toBe("1");
    expect(waves[1].tasks[0].id).toBe("2");
  });

  test("WAW tasks are sequenced", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", ["auth"])];
    const waves = computeWaves(tasks);
    expect(waves).toHaveLength(2);
  });

  test("diamond dependency", () => {
    const tasks = [
      makeTask("1", ["core"]), // writes core
      makeTask("2", ["auth"], ["core"]), // reads core, writes auth
      makeTask("3", ["api"], ["core"]), // reads core, writes api
      makeTask("4", undefined, ["auth", "api"]), // reads auth + api
    ];
    const waves = computeWaves(tasks);
    // Wave 0: task 1 (writes core)
    // Wave 1: tasks 2, 3 (read core, write different components)
    // Wave 2: task 4 (reads auth + api)
    expect(waves).toHaveLength(3);
    expect(waves[0].tasks.map((t) => t.id)).toEqual(["1"]);
    expect(waves[1].tasks.map((t) => t.id).sort()).toEqual(["2", "3"]);
    expect(waves[2].tasks.map((t) => t.id)).toEqual(["4"]);
  });

  test("empty tasks", () => {
    expect(computeWaves([])).toEqual([]);
  });
});
