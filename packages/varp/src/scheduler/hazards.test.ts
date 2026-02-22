import { describe, test, expect } from "bun:test";

import { makeTask, makeTaskDef } from "#shared/test-helpers.js";

import { detectHazards } from "./hazards.js";

describe("detectHazards", () => {
  test("detects RAW hazard", () => {
    const tasks = [
      makeTask("1", ["auth"]), // writes auth
      makeTask("2", undefined, ["auth"]), // reads auth
    ];
    const hazards = detectHazards(tasks);
    const raw = hazards.filter((h) => h.type === "RAW");
    expect(raw).toHaveLength(1);
    expect(raw[0].source_task_id).toBe("1");
    expect(raw[0].target_task_id).toBe("2");
    expect(raw[0].component).toBe("auth");
  });

  test("detects WAW hazard", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", ["auth"])];
    const hazards = detectHazards(tasks);
    const waw = hazards.filter((h) => h.type === "WAW");
    expect(waw).toHaveLength(1);
    expect(waw[0].component).toBe("auth");
  });

  test("detects WAR hazard", () => {
    const tasks = [
      makeTask("1", undefined, ["auth"]), // reads auth
      makeTask("2", ["auth"]), // writes auth
    ];
    const hazards = detectHazards(tasks);
    const war = hazards.filter((h) => h.type === "WAR");
    expect(war).toHaveLength(1);
    expect(war[0].source_task_id).toBe("1");
    expect(war[0].target_task_id).toBe("2");
  });

  test("no hazards for independent tasks", () => {
    const tasks = [makeTask("1", ["auth"]), makeTask("2", ["api"])];
    expect(detectHazards(tasks)).toHaveLength(0);
  });

  test("detects MUTEX hazard for shared mutex names", () => {
    const tasks = [
      makeTask("1", ["auth"], undefined, ["db-migration"]),
      makeTask("2", ["api"], undefined, ["db-migration"]),
    ];
    const hazards = detectHazards(tasks);
    const mutex = hazards.filter((h) => h.type === "MUTEX");
    expect(mutex).toHaveLength(1);
    expect(mutex[0].source_task_id).toBe("1");
    expect(mutex[0].target_task_id).toBe("2");
    expect(mutex[0].component).toBe("db-migration");
  });

  test("no MUTEX hazard for different mutex names", () => {
    const tasks = [
      makeTask("1", ["auth"], undefined, ["db-migration"]),
      makeTask("2", ["api"], undefined, ["port-3000"]),
    ];
    const hazards = detectHazards(tasks);
    const mutex = hazards.filter((h) => h.type === "MUTEX");
    expect(mutex).toHaveLength(0);
  });

  test("MUTEX hazard reported per shared name", () => {
    const tasks = [
      makeTask("1", ["auth"], undefined, ["db-migration", "port-3000"]),
      makeTask("2", ["api"], undefined, ["db-migration", "port-3000"]),
    ];
    const hazards = detectHazards(tasks);
    const mutex = hazards.filter((h) => h.type === "MUTEX");
    expect(mutex).toHaveLength(2);
    const names = mutex.map((h) => h.component).sort();
    expect(names).toEqual(["db-migration", "port-3000"]);
  });

  test("detects all three hazard types", () => {
    const tasks = [makeTask("1", ["auth"], ["api"]), makeTask("2", ["auth", "api"])];
    const hazards = detectHazards(tasks);
    const types = new Set(hazards.map((h) => h.type));
    expect(types.has("RAW")).toBe(true);
    expect(types.has("WAW")).toBe(true);
    // WAR: task 1 reads api, task 2 writes api, task 1 doesn't write api
    expect(types.has("WAR")).toBe(true);
  });

  test("works with TaskDefinition (no execution fields)", () => {
    const tasks = [makeTaskDef("1", ["auth"]), makeTaskDef("2", undefined, ["auth"])];
    const hazards = detectHazards(tasks);
    expect(hazards.filter((h) => h.type === "RAW")).toHaveLength(1);
  });
});
