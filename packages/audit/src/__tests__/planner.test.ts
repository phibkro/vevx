import type { FileContent } from "../agents/types";
import { generatePlan, groupIntoComponents } from "../planner/planner";
import type { Ruleset } from "../planner/types";

function makeFile(relativePath: string, content = "// code"): FileContent {
  return {
    path: `/project/${relativePath}`,
    relativePath,
    language: /\.tsx?$/.test(relativePath) ? "typescript" : "javascript",
    content,
  };
}

const MOCK_RULESET: Ruleset = {
  meta: {
    framework: "OWASP Top 10",
    version: "2021",
    rulesetVersion: "0.1.0",
    scope: "Web applications",
    languages: ["typescript", "javascript"],
  },
  rules: [
    {
      id: "BAC-01",
      title: "Missing Authorization",
      category: "A01 — Broken Access Control",
      severity: "Critical",
      appliesTo: ["API routes", "HTTP handlers"],
      compliant: "Checks permissions",
      violation: "No ownership check",
      whatToLookFor: ["route handlers without auth"],
      guidance: "Check auth",
    },
    {
      id: "INJ-01",
      title: "SQL Injection",
      category: "A03 — Injection",
      severity: "Critical",
      appliesTo: ["database access layers", "query builders"],
      compliant: "Parameterized queries",
      violation: "String concatenation",
      whatToLookFor: ["template literal SQL"],
      guidance: "Use ORMs",
    },
    {
      id: "MISCONFIG-01",
      title: "Debug Mode in Prod",
      category: "A05 — Security Misconfiguration",
      severity: "High",
      appliesTo: ["configuration files", "error handlers"],
      compliant: "No stack traces in prod",
      violation: "Stack traces in responses",
      whatToLookFor: ["error handlers returning stack"],
      guidance: "Check env",
    },
  ],
  crossCutting: [
    {
      id: "CROSS-01",
      title: "PII Data Flow",
      scope: "Full codebase",
      relatesTo: ["BAC-01", "INJ-01"],
      objective: "Trace PII from input to output",
      checks: ["PII encrypted at rest", "PII not logged"],
    },
  ],
};

describe("groupIntoComponents", () => {
  it("groups files by top-level directory", () => {
    const files = [
      makeFile("src/api/routes.ts"),
      makeFile("src/api/middleware.ts"),
      makeFile("src/db/queries.ts"),
      makeFile("config.ts"),
    ];

    const components = groupIntoComponents(files);

    expect(components).toHaveLength(3);
    const names = components.map((c) => c.name).sort();
    expect(names).toEqual(["root", "src/api", "src/db"]);
  });

  it("root component captures top-level files", () => {
    const files = [makeFile("index.ts"), makeFile("config.ts")];
    const components = groupIntoComponents(files);

    expect(components).toHaveLength(1);
    expect(components[0].name).toBe("root");
    expect(components[0].files).toHaveLength(2);
  });

  it("detects languages per component", () => {
    const files = [makeFile("src/app/page.tsx"), makeFile("src/app/layout.js")];

    const components = groupIntoComponents(files);
    expect(components[0].languages).toContain("typescript");
    expect(components[0].languages).toContain("javascript");
  });
});

describe("generatePlan", () => {
  it("generates 3-wave plan", () => {
    const files = [
      makeFile("src/api/routes.ts"),
      makeFile("src/db/queries.ts"),
      makeFile("src/config/settings.ts"),
    ];

    const plan = generatePlan(files, MOCK_RULESET);

    expect(plan.waves.wave1.length).toBeGreaterThan(0);
    expect(plan.waves.wave2).toHaveLength(1);
    expect(plan.waves.wave3).toHaveLength(1);
  });

  it("wave 1 tasks are component scans", () => {
    const files = [makeFile("src/api/routes.ts"), makeFile("src/db/queries.ts")];

    const plan = generatePlan(files, MOCK_RULESET);

    for (const task of plan.waves.wave1) {
      expect(task.wave).toBe(1);
      expect(task.type).toBe("component-scan");
      expect(task.component).toBeDefined();
      expect(task.rules.length).toBeGreaterThan(0);
      expect(task.files.length).toBeGreaterThan(0);
    }
  });

  it("wave 2 tasks are cross-cutting", () => {
    const files = [makeFile("src/api/routes.ts")];
    const plan = generatePlan(files, MOCK_RULESET);

    expect(plan.waves.wave2[0].type).toBe("cross-cutting");
    expect(plan.waves.wave2[0].rules).toContain("CROSS-01");
    expect(plan.waves.wave2[0].rules).toContain("BAC-01");
  });

  it("wave 3 is synthesis", () => {
    const files = [makeFile("src/api/routes.ts")];
    const plan = generatePlan(files, MOCK_RULESET);

    expect(plan.waves.wave3).toHaveLength(1);
    expect(plan.waves.wave3[0].type).toBe("synthesis");
  });

  it("wave 1 sorted by severity priority", () => {
    const files = [
      makeFile("src/api/routes.ts"),
      makeFile("src/config/settings.ts"),
      makeFile("src/db/queries.ts"),
    ];

    const plan = generatePlan(files, MOCK_RULESET);

    // Critical tasks should come before High tasks
    const priorities = plan.waves.wave1.map((t) => t.priority);
    for (let i = 1; i < priorities.length; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i - 1]);
    }
  });

  it("matches rules to relevant files", () => {
    const files = [
      makeFile("src/api/routes.ts"), // should match BAC-01 (API routes)
      makeFile("src/db/repository.ts"), // should match INJ-01 (database)
      makeFile("src/utils/helpers.ts"), // may not match any specific rule
    ];

    const plan = generatePlan(files, MOCK_RULESET);
    const wave1 = plan.waves.wave1;

    // API routes should be checked against BAC-01
    const apiTask = wave1.find((t) => t.component === "src/api" && t.rules.includes("BAC-01"));
    expect(apiTask).toBeDefined();

    // DB should be checked against INJ-01
    const dbTask = wave1.find((t) => t.component === "src/db" && t.rules.includes("INJ-01"));
    expect(dbTask).toBeDefined();
  });

  it("stats are accurate", () => {
    const files = [makeFile("src/api/routes.ts"), makeFile("src/db/queries.ts")];

    const plan = generatePlan(files, MOCK_RULESET);

    expect(plan.stats.totalFiles).toBe(2);
    expect(plan.stats.totalRules).toBe(4); // 3 rules + 1 cross-cutting
    expect(plan.stats.totalTasks).toBe(
      plan.waves.wave1.length + plan.waves.wave2.length + plan.waves.wave3.length,
    );
  });

  it("handles empty file list", () => {
    const plan = generatePlan([], MOCK_RULESET);

    expect(plan.waves.wave1).toHaveLength(0);
    expect(plan.waves.wave2).toHaveLength(1); // cross-cutting still created
    expect(plan.waves.wave3).toHaveLength(1); // synthesis still created
    expect(plan.stats.totalFiles).toBe(0);
  });

  it("populates component info", () => {
    const files = [
      makeFile("src/api/routes.ts", "const x = 1;"),
      makeFile("src/api/middleware.ts", "const y = 2;"),
    ];

    const plan = generatePlan(files, MOCK_RULESET);

    expect(plan.components.length).toBeGreaterThan(0);
    const apiComponent = plan.components.find((c) => c.name === "src/api");
    expect(apiComponent).toBeDefined();
    expect(apiComponent!.files).toHaveLength(2);
    expect(apiComponent!.languages).toContain("typescript");
  });
});
