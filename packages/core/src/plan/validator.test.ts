import { describe, test, expect } from "bun:test";

import type { Manifest } from "#shared/types.js";

import { detectHazards } from "../scheduler/hazards.js";
import { validatePlan } from "./validator.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "./src/auth", docs: [] },
    api: { path: "./src/api", deps: ["auth"], docs: [] },
  },
};

import { makeTask, makePlan } from "#shared/test-helpers.js";

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

  // ── Import dep warnings ──

  test("warns when task writes to component with undeclared import dep", () => {
    const plan = makePlan([makeTask("1", ["api"])]);
    const importDeps = [
      {
        from: "api",
        to: "auth",
        evidence: [{ source_file: "x.ts", import_specifier: "../auth/index.js" }],
      },
    ];
    const result = validatePlan(plan, manifest, [], importDeps);
    expect(result.warnings.some((w) => w.includes('writes to "api"') && w.includes('"auth"'))).toBe(
      true,
    );
  });

  test("no warning when task already declares the read", () => {
    const plan = makePlan([makeTask("1", ["api"], ["auth"])]);
    const importDeps = [
      {
        from: "api",
        to: "auth",
        evidence: [{ source_file: "x.ts", import_specifier: "../auth/index.js" }],
      },
    ];
    const result = validatePlan(plan, manifest, [], importDeps);
    expect(result.warnings.some((w) => w.includes('writes to "api"') && w.includes('"auth"'))).toBe(
      false,
    );
  });

  test("no warning when writing to component also covers the dep (writes implies reads)", () => {
    const plan = makePlan([makeTask("1", ["api", "auth"])]);
    const importDeps = [
      {
        from: "api",
        to: "auth",
        evidence: [{ source_file: "x.ts", import_specifier: "../auth/index.js" }],
      },
    ];
    const result = validatePlan(plan, manifest, [], importDeps);
    expect(result.warnings.some((w) => w.includes('writes to "api"') && w.includes('"auth"'))).toBe(
      false,
    );
  });

  test("backwards compatible: no importDeps means no warnings", () => {
    const plan = makePlan([makeTask("1", ["api"])]);
    const result = validatePlan(plan, manifest);
    expect(result.warnings).toHaveLength(0);
  });

  // ── Dead mutex warnings ──

  test("warns on dead mutex (only used by one task)", () => {
    const plan = makePlan([
      makeTask("1", ["auth"], undefined, ["db-migration"]),
      makeTask("2", ["api"]),
    ]);
    const result = validatePlan(plan, manifest);
    expect(
      result.warnings.some((w) => w.includes("Dead mutex") && w.includes("db-migration")),
    ).toBe(true);
  });

  test("no warning when mutex is shared by multiple tasks", () => {
    const plan = makePlan([
      makeTask("1", ["auth"], undefined, ["db-migration"]),
      makeTask("2", ["api"], undefined, ["db-migration"]),
    ]);
    const result = validatePlan(plan, manifest);
    expect(result.warnings.some((w) => w.includes("Dead mutex"))).toBe(false);
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
