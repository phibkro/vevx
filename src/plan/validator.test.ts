import { describe, test, expect } from "bun:test";
import { validatePlan } from "./validator.js";
import { detectHazards } from "../scheduler/hazards.js";
import type { Manifest } from "../types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "./src/auth", docs: [] },
    api: { path: "./src/api", deps: ["auth"], docs: [] },
  },
};

import { makeTask, makePlan } from "../test-helpers.js";

describe("validatePlan", () => {
  test("valid plan passes", () => {
    const plan = makePlan([makeTask("1", ["auth"], ["api"])]);
    const result = validatePlan(plan, manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("unknown component is an error", () => {
    const plan = makePlan([makeTask("1", ["nonexistent"])]);
    const result = validatePlan(plan, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("nonexistent"))).toBe(true);
  });

  test("duplicate task ID is an error", () => {
    const plan = makePlan([makeTask("1", ["auth"]), makeTask("1", ["api"])]);
    const result = validatePlan(plan, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  test("WAW is a warning, not error", () => {
    const plan = makePlan([makeTask("1", ["auth"]), makeTask("2", ["auth"])]);
    const hazards = detectHazards(plan.tasks);
    const result = validatePlan(plan, manifest, hazards);
    expect(result.warnings.some((w) => w.includes("WAW"))).toBe(true);
  });

  test("empty verify command is an error", () => {
    const plan = makePlan([makeTask("1", ["auth"])], {
      postconditions: [{ id: "post-1", description: "test", verify: "  " }],
    });
    const result = validatePlan(plan, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("verify command is empty"))).toBe(true);
  });
});
