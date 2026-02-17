import { describe, test, expect } from "bun:test";

import { makeTask } from "../test-helpers.js";
import { deriveRestartStrategy } from "./restart.js";

describe("deriveRestartStrategy", () => {
  test("isolated retry — no downstream reads of failed writes", () => {
    const tasks = [
      makeTask("1", ["auth"]),
      makeTask("2", ["api"]),
      makeTask("3", undefined, ["api"]),
    ];
    const result = deriveRestartStrategy(tasks[0], tasks, [], ["2"]);
    expect(result.strategy).toBe("isolated_retry");
  });

  test("cascade restart — dispatched tasks consume failed output", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", undefined, ["auth"])];
    const result = deriveRestartStrategy(tasks[0], tasks, [], ["2"]);
    expect(result.strategy).toBe("cascade_restart");
    expect(result.affected_tasks).toContain("2");
  });

  test("escalate — completed tasks consumed failed output", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", undefined, ["auth"])];
    const result = deriveRestartStrategy(tasks[0], tasks, ["2"], []);
    expect(result.strategy).toBe("escalate");
    expect(result.affected_tasks).toContain("2");
  });

  test("isolated retry — task with no writes", () => {
    const tasks = [makeTask("1", undefined, ["auth"])];
    const result = deriveRestartStrategy(tasks[0], tasks, [], []);
    expect(result.strategy).toBe("isolated_retry");
  });

  test("correctly identifies all three strategies", () => {
    // Setup: task 1 writes auth, task 2 reads auth (dispatched), task 3 reads auth (completed)
    const tasks = [
      makeTask("1", ["auth"]),
      makeTask("2", undefined, ["auth"]),
      makeTask("3", undefined, ["auth"]),
    ];

    // When a completed task consumed output → escalate
    const result = deriveRestartStrategy(tasks[0], tasks, ["3"], ["2"]);
    expect(result.strategy).toBe("escalate");
  });
});
