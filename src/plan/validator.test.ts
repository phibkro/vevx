import { describe, test, expect } from "bun:test";
import { validatePlan } from "./validator.js";
import type { Plan, Manifest } from "../types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "./src/auth", docs: [] },
    api: { path: "./src/api", deps: ["auth"], docs: [] },
  },
};

function makePlan(tasks: Plan["tasks"], contract?: Partial<Plan["contract"]>): Plan {
  return {
    metadata: { feature: "test", created: "2026-01-01" },
    contract: {
      preconditions: contract?.preconditions ?? [],
      invariants: contract?.invariants ?? [],
      postconditions: contract?.postconditions ?? [{ id: "post-1", description: "test", verify: "echo ok" }],
    },
    tasks,
  };
}

function makeTask(id: string, writes?: string[], reads?: string[]): Plan["tasks"][0] {
  return {
    id,
    description: `Task ${id}`,
    action: "implement",
    values: ["correctness"],
    touches: { writes, reads },
    budget: { tokens: 10000, minutes: 5 },
  };
}

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
    expect(result.errors.some(e => e.includes("nonexistent"))).toBe(true);
  });

  test("duplicate task ID is an error", () => {
    const plan = makePlan([makeTask("1", ["auth"]), makeTask("1", ["api"])]);
    const result = validatePlan(plan, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("Duplicate"))).toBe(true);
  });

  test("WAW is a warning, not error", () => {
    const plan = makePlan([makeTask("1", ["auth"]), makeTask("2", ["auth"])]);
    const result = validatePlan(plan, manifest);
    expect(result.warnings.some(w => w.includes("WAW"))).toBe(true);
  });

  test("empty verify command is an error", () => {
    const plan = makePlan(
      [makeTask("1", ["auth"])],
      { postconditions: [{ id: "post-1", description: "test", verify: "  " }] }
    );
    const result = validatePlan(plan, manifest);
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes("verify command is empty"))).toBe(true);
  });
});
