import { describe, test, expect } from "bun:test";

import type { Plan } from "#shared/types.js";

import { diffPlans } from "./diff.js";

function makePlan(overrides: Partial<Plan> = {}): Plan {
  return {
    metadata: { feature: "Test Feature", created: "2026-02-16" },
    contract: {
      preconditions: [{ id: "pre-1", description: "Source exists", verify: "test -d src" }],
      invariants: [{ id: "inv-1", description: "Tests pass", verify: "bun test", critical: true }],
      postconditions: [
        { id: "post-1", description: "Feature works", verify: "bun test --filter=feature" },
      ],
    },
    tasks: [
      {
        id: "1",
        description: "Implement auth",
        action: "implement",
        values: ["correctness"],
        touches: { writes: ["auth"], reads: ["api"] },
        budget: { tokens: 30000, minutes: 10 },
      },
      {
        id: "2",
        description: "Update API",
        action: "implement",
        values: ["correctness"],
        touches: { writes: ["api"], reads: ["auth"] },
        budget: { tokens: 20000, minutes: 8 },
      },
    ],
    ...overrides,
  };
}

describe("diffPlans", () => {
  test("identical plans produce empty diff", () => {
    const plan = makePlan();
    const diff = diffPlans(plan, plan);
    expect(diff.metadata).toEqual([]);
    expect(diff.contracts).toEqual([]);
    expect(diff.tasks).toEqual([]);
  });

  test("detects metadata feature change", () => {
    const planA = makePlan();
    const planB = makePlan({ metadata: { feature: "New Feature", created: "2026-02-16" } });
    const diff = diffPlans(planA, planB);
    expect(diff.metadata).toHaveLength(1);
    expect(diff.metadata[0]).toEqual({
      field: "feature",
      old_value: "Test Feature",
      new_value: "New Feature",
    });
  });

  test("detects metadata created date change", () => {
    const planA = makePlan();
    const planB = makePlan({ metadata: { feature: "Test Feature", created: "2026-02-17" } });
    const diff = diffPlans(planA, planB);
    expect(diff.metadata).toHaveLength(1);
    expect(diff.metadata[0].field).toBe("created");
  });

  test("detects both metadata fields changed", () => {
    const planA = makePlan();
    const planB = makePlan({ metadata: { feature: "New", created: "2026-03-01" } });
    const diff = diffPlans(planA, planB);
    expect(diff.metadata).toHaveLength(2);
  });

  test("detects added task", () => {
    const planA = makePlan();
    const planB = makePlan({
      tasks: [
        ...planA.tasks,
        {
          id: "3",
          description: "New task",
          action: "test",
          values: ["coverage"],
          touches: { reads: ["auth"] },
          budget: { tokens: 10000, minutes: 5 },
        },
      ],
    });
    const diff = diffPlans(planA, planB);
    const added = diff.tasks.filter((t) => t.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe("3");
  });

  test("detects removed task", () => {
    const planA = makePlan();
    const planB = makePlan({ tasks: [planA.tasks[0]] });
    const diff = diffPlans(planA, planB);
    const removed = diff.tasks.filter((t) => t.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe("2");
  });

  test("detects modified task description", () => {
    const planA = makePlan();
    const planB = makePlan({
      tasks: [{ ...planA.tasks[0], description: "Updated description" }, planA.tasks[1]],
    });
    const diff = diffPlans(planA, planB);
    const modified = diff.tasks.filter((t) => t.type === "modified");
    expect(modified).toHaveLength(1);
    expect(modified[0].id).toBe("1");
    expect(modified[0].changes).toContainEqual({
      field: "description",
      old_value: "Implement auth",
      new_value: "Updated description",
    });
  });

  test("detects modified task touches", () => {
    const planA = makePlan();
    const planB = makePlan({
      tasks: [
        { ...planA.tasks[0], touches: { writes: ["auth", "web"], reads: ["api"] } },
        planA.tasks[1],
      ],
    });
    const diff = diffPlans(planA, planB);
    const modified = diff.tasks.filter((t) => t.type === "modified");
    expect(modified).toHaveLength(1);
    expect(modified[0].changes!.some((c) => c.field === "touches")).toBe(true);
  });

  test("detects modified task budget", () => {
    const planA = makePlan();
    const planB = makePlan({
      tasks: [{ ...planA.tasks[0], budget: { tokens: 50000, minutes: 20 } }, planA.tasks[1]],
    });
    const diff = diffPlans(planA, planB);
    const modified = diff.tasks.filter((t) => t.type === "modified");
    expect(modified).toHaveLength(1);
    expect(modified[0].changes!.some((c) => c.field === "budget")).toBe(true);
  });

  test("detects modified task action and values", () => {
    const planA = makePlan();
    const planB = makePlan({
      tasks: [
        { ...planA.tasks[0], action: "refactor", values: ["simplicity", "correctness"] },
        planA.tasks[1],
      ],
    });
    const diff = diffPlans(planA, planB);
    const modified = diff.tasks.filter((t) => t.type === "modified");
    expect(modified).toHaveLength(1);
    const fields = modified[0].changes!.map((c) => c.field);
    expect(fields).toContain("action");
    expect(fields).toContain("values");
  });

  test("detects added precondition", () => {
    const planA = makePlan();
    const planB = makePlan({
      contract: {
        ...planA.contract,
        preconditions: [
          ...planA.contract.preconditions,
          { id: "pre-2", description: "DB ready", verify: "pg_isready" },
        ],
      },
    });
    const diff = diffPlans(planA, planB);
    const added = diff.contracts.filter((c) => c.type === "added");
    expect(added).toHaveLength(1);
    expect(added[0].id).toBe("pre-2");
    expect(added[0].section).toBe("preconditions");
  });

  test("detects removed invariant", () => {
    const planA = makePlan();
    const planB = makePlan({
      contract: {
        ...planA.contract,
        invariants: [],
      },
    });
    const diff = diffPlans(planA, planB);
    const removed = diff.contracts.filter((c) => c.type === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0].id).toBe("inv-1");
    expect(removed[0].section).toBe("invariants");
  });

  test("detects modified postcondition", () => {
    const planA = makePlan();
    const planB = makePlan({
      contract: {
        ...planA.contract,
        postconditions: [
          { id: "post-1", description: "Feature works well", verify: "bun test --filter=feature" },
        ],
      },
    });
    const diff = diffPlans(planA, planB);
    const modified = diff.contracts.filter((c) => c.type === "modified");
    expect(modified).toHaveLength(1);
    expect(modified[0].id).toBe("post-1");
    expect(modified[0].old_value!.description).toBe("Feature works");
    expect(modified[0].new_value!.description).toBe("Feature works well");
  });

  test("detects modified invariant critical flag", () => {
    const planA = makePlan();
    const planB = makePlan({
      contract: {
        ...planA.contract,
        invariants: [
          { id: "inv-1", description: "Tests pass", verify: "bun test", critical: false },
        ],
      },
    });
    const diff = diffPlans(planA, planB);
    const modified = diff.contracts.filter((c) => c.type === "modified");
    expect(modified).toHaveLength(1);
    expect(modified[0].old_value!.critical).toBe(true);
    expect(modified[0].new_value!.critical).toBe(false);
  });
});
