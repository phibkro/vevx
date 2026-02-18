import type { FileContent } from "../agents/types";
import {
  generateComponentScanPrompt,
  generateCrossCuttingPrompt,
  generatePrompt,
  parseAuditResponse,
} from "../planner/prompt-generator";
import type { AuditTask, Ruleset } from "../planner/types";

// ── Fixtures ──

const MOCK_RULESET: Ruleset = {
  meta: {
    framework: "OWASP Top 10",
    version: "2021",
    rulesetVersion: "0.1.0",
    scope: "Web applications",
    languages: ["typescript"],
  },
  rules: [
    {
      id: "BAC-01",
      title: "Missing Authorization Checks",
      category: "A01 — Broken Access Control",
      severity: "Critical",
      appliesTo: ["API routes"],
      compliant: "Every endpoint verifies permissions",
      violation: "Endpoints without ownership checks",
      whatToLookFor: ["Route handlers without auth middleware"],
      guidance: "Check auth on every endpoint",
    },
    {
      id: "INJ-01",
      title: "SQL Injection",
      category: "A03 — Injection",
      severity: "Critical",
      appliesTo: ["database access"],
      compliant: "Parameterized queries",
      violation: "String concatenation in SQL",
      whatToLookFor: ["Template literal SQL", "prisma.$queryRawUnsafe()"],
      guidance: "ORMs handle parameterization by default",
    },
  ],
  crossCutting: [
    {
      id: "CROSS-01",
      title: "PII Data Flow Tracing",
      scope: "Full codebase",
      relatesTo: ["BAC-01"],
      objective: "Trace PII from input to output",
      checks: ["PII is encrypted at rest", "PII is not logged"],
    },
  ],
};

function makeFile(relativePath: string, content: string): FileContent {
  return {
    path: `/project/${relativePath}`,
    relativePath,
    language: "typescript",
    content,
  };
}

const SCAN_TASK: AuditTask = {
  id: "scan-1",
  wave: 1,
  type: "component-scan",
  component: "src/api",
  rules: ["BAC-01", "INJ-01"],
  files: ["src/api/routes.ts"],
  estimatedTokens: 500,
  priority: 0,
  description: "Scan src/api against A01, A03",
};

const CROSS_TASK: AuditTask = {
  id: "cross-1",
  wave: 2,
  type: "cross-cutting",
  rules: ["CROSS-01", "BAC-01"],
  files: ["src/api/routes.ts", "src/db/users.ts"],
  estimatedTokens: 1000,
  priority: 0,
  description: "PII Data Flow Tracing",
};

const FILES = [
  makeFile("src/api/routes.ts", 'app.get("/users/:id", handler);\n'),
  makeFile("src/db/users.ts", "const q = `SELECT * FROM users WHERE id = ${id}`;\n"),
];

// ── Component scan prompt ──

describe("generateComponentScanPrompt", () => {
  it("includes framework name in system prompt", () => {
    const { systemPrompt } = generateComponentScanPrompt(SCAN_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("OWASP Top 10");
  });

  it("includes all task rules in system prompt", () => {
    const { systemPrompt } = generateComponentScanPrompt(SCAN_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("BAC-01");
    expect(systemPrompt).toContain("Missing Authorization Checks");
    expect(systemPrompt).toContain("INJ-01");
    expect(systemPrompt).toContain("SQL Injection");
  });

  it("includes rule details", () => {
    const { systemPrompt } = generateComponentScanPrompt(SCAN_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("Route handlers without auth middleware");
    expect(systemPrompt).toContain("prisma.$queryRawUnsafe()");
    expect(systemPrompt).toContain("ORMs handle parameterization");
  });

  it("includes finding schema in system prompt", () => {
    const { systemPrompt } = generateComponentScanPrompt(SCAN_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain('"ruleId"');
    expect(systemPrompt).toContain('"severity"');
    expect(systemPrompt).toContain('"confidence"');
  });

  it("formats files with line numbers in user prompt", () => {
    const { userPrompt } = generateComponentScanPrompt(SCAN_TASK, FILES, MOCK_RULESET);
    expect(userPrompt).toContain("1→app.get");
    expect(userPrompt).toContain("File: src/api/routes.ts");
  });

  it("includes component name in user prompt", () => {
    const { userPrompt } = generateComponentScanPrompt(SCAN_TASK, FILES, MOCK_RULESET);
    expect(userPrompt).toContain("Component: src/api");
  });

  it("only includes rules referenced by the task", () => {
    const taskWithOneRule: AuditTask = { ...SCAN_TASK, rules: ["BAC-01"] };
    const { systemPrompt } = generateComponentScanPrompt(taskWithOneRule, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("BAC-01");
    expect(systemPrompt).not.toContain("INJ-01");
  });
});

// ── Cross-cutting prompt ──

describe("generateCrossCuttingPrompt", () => {
  it("includes pattern details in system prompt", () => {
    const { systemPrompt } = generateCrossCuttingPrompt(CROSS_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("CROSS-01");
    expect(systemPrompt).toContain("PII Data Flow Tracing");
    expect(systemPrompt).toContain("Trace PII from input to output");
  });

  it("includes checks to verify", () => {
    const { systemPrompt } = generateCrossCuttingPrompt(CROSS_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("PII is encrypted at rest");
    expect(systemPrompt).toContain("PII is not logged");
  });

  it("includes related rules", () => {
    const { systemPrompt } = generateCrossCuttingPrompt(CROSS_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("Related Rules");
    expect(systemPrompt).toContain("BAC-01");
  });

  it("describes cross-cutting analysis role", () => {
    const { systemPrompt } = generateCrossCuttingPrompt(CROSS_TASK, FILES, MOCK_RULESET);
    expect(systemPrompt).toContain("cross-cutting");
    expect(systemPrompt).toContain("tracing behaviors across the codebase");
  });

  it("throws for unknown pattern ID", () => {
    const badTask: AuditTask = { ...CROSS_TASK, rules: ["CROSS-99"] };
    expect(() => generateCrossCuttingPrompt(badTask, FILES, MOCK_RULESET)).toThrow("CROSS-99");
  });
});

// ── generatePrompt dispatcher ──

describe("generatePrompt", () => {
  it("dispatches component-scan tasks", () => {
    const prompt = generatePrompt(SCAN_TASK, FILES, MOCK_RULESET);
    expect(prompt.systemPrompt).toContain("BAC-01");
  });

  it("dispatches cross-cutting tasks", () => {
    const prompt = generatePrompt(CROSS_TASK, FILES, MOCK_RULESET);
    expect(prompt.systemPrompt).toContain("CROSS-01");
  });

  it("throws for synthesis tasks", () => {
    const synthTask: AuditTask = { ...SCAN_TASK, type: "synthesis" };
    expect(() => generatePrompt(synthTask, FILES, MOCK_RULESET)).toThrow("Synthesis");
  });
});

// ── Response parsing ──

describe("parseAuditResponse", () => {
  const META = { model: "claude-sonnet-4-5-20250929", tokensUsed: 5000, durationMs: 3000 };

  it("parses valid JSON response", () => {
    const raw = JSON.stringify({
      findings: [
        {
          ruleId: "BAC-01",
          severity: "critical",
          title: "Missing auth on /users/:id",
          description: "No authorization check",
          locations: [{ file: "src/api/routes.ts", startLine: 1 }],
          evidence: 'app.get("/users/:id", handler)',
          remediation: "Add auth middleware",
          confidence: 0.9,
        },
      ],
    });

    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe("BAC-01");
    expect(result.findings[0].severity).toBe("critical");
    expect(result.findings[0].confidence).toBe(0.9);
    expect(result.taskId).toBe("scan-1");
  });

  it("handles JSON in markdown code fences", () => {
    const raw =
      '```json\n{"findings": [{"ruleId": "BAC-01", "severity": "high", "title": "test", "description": "", "locations": [{"file": "a.ts", "startLine": 1}], "evidence": "", "remediation": "", "confidence": 0.8}]}\n```';
    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe("BAC-01");
  });

  it("normalizes severity variations", () => {
    const raw = JSON.stringify({
      findings: [
        {
          ruleId: "A",
          severity: "warning",
          title: "t",
          description: "",
          locations: [{ file: "a.ts", startLine: 1 }],
          evidence: "",
          remediation: "",
          confidence: 0.5,
        },
        {
          ruleId: "B",
          severity: "info",
          title: "t",
          description: "",
          locations: [{ file: "b.ts", startLine: 1 }],
          evidence: "",
          remediation: "",
          confidence: 0.5,
        },
        {
          ruleId: "C",
          severity: "CRITICAL",
          title: "t",
          description: "",
          locations: [{ file: "c.ts", startLine: 1 }],
          evidence: "",
          remediation: "",
          confidence: 0.5,
        },
      ],
    });

    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings[0].severity).toBe("medium"); // warning → medium
    expect(result.findings[1].severity).toBe("informational"); // info → informational
    expect(result.findings[2].severity).toBe("critical"); // CRITICAL → critical
  });

  it("clamps confidence to [0, 1]", () => {
    const raw = JSON.stringify({
      findings: [
        {
          ruleId: "A",
          severity: "high",
          title: "t",
          description: "",
          locations: [{ file: "a.ts", startLine: 1 }],
          evidence: "",
          remediation: "",
          confidence: 1.5,
        },
        {
          ruleId: "B",
          severity: "high",
          title: "t",
          description: "",
          locations: [{ file: "b.ts", startLine: 1 }],
          evidence: "",
          remediation: "",
          confidence: -0.3,
        },
      ],
    });

    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings[0].confidence).toBe(1.0);
    expect(result.findings[1].confidence).toBe(0);
  });

  it("handles empty findings", () => {
    const raw = '{"findings": []}';
    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings).toHaveLength(0);
    expect(result.rulesChecked).toEqual(["BAC-01", "INJ-01"]);
  });

  it("returns error finding on invalid JSON", () => {
    const raw = "This is not JSON at all";
    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe("PARSE-ERROR");
    expect(result.findings[0].severity).toBe("informational");
  });

  it("handles missing location gracefully", () => {
    const raw = JSON.stringify({
      findings: [
        {
          ruleId: "BAC-01",
          severity: "high",
          title: "t",
          description: "",
          evidence: "",
          remediation: "",
          confidence: 0.8,
        },
      ],
    });

    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    // Falls back to first file in task
    expect(result.findings[0].locations).toHaveLength(1);
    expect(result.findings[0].locations[0].file).toBe("src/api/routes.ts");
  });

  it("handles single location object (not array)", () => {
    const raw = JSON.stringify({
      findings: [
        {
          ruleId: "BAC-01",
          severity: "high",
          title: "t",
          description: "",
          location: { file: "x.ts", startLine: 5 },
          evidence: "",
          remediation: "",
          confidence: 0.8,
        },
      ],
    });

    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings[0].locations[0].file).toBe("x.ts");
    expect(result.findings[0].locations[0].startLine).toBe(5);
  });

  it("accepts snake_case field names from LLM", () => {
    const raw = JSON.stringify({
      findings: [
        {
          rule_id: "BAC-01",
          severity: "high",
          title: "t",
          description: "",
          locations: [{ file: "a.ts", start_line: 10, end_line: 15 }],
          evidence: "",
          remediation: "",
          confidence: 0.8,
        },
      ],
    });

    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings[0].ruleId).toBe("BAC-01");
    expect(result.findings[0].locations[0].startLine).toBe(10);
    expect(result.findings[0].locations[0].endLine).toBe(15);
  });

  it("truncates long titles to 80 chars", () => {
    const longTitle = "A".repeat(120);
    const raw = JSON.stringify({
      findings: [
        {
          ruleId: "BAC-01",
          severity: "high",
          title: longTitle,
          description: "",
          locations: [{ file: "a.ts", startLine: 1 }],
          evidence: "",
          remediation: "",
          confidence: 0.8,
        },
      ],
    });

    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.findings[0].title.length).toBe(80);
  });

  it("preserves task metadata", () => {
    const raw = '{"findings": []}';
    const result = parseAuditResponse(raw, SCAN_TASK, META.model, META.tokensUsed, META.durationMs);
    expect(result.taskId).toBe("scan-1");
    expect(result.type).toBe("component-scan");
    expect(result.component).toBe("src/api");
    expect(result.model).toBe("claude-sonnet-4-5-20250929");
    expect(result.tokensUsed).toBe(5000);
    expect(result.durationMs).toBe(3000);
  });

  it("uses pre-parsed structured output when provided", () => {
    const structured = {
      findings: [
        {
          ruleId: "BAC-01",
          severity: "critical",
          title: "Structured output finding",
          description: "From constrained decoding",
          locations: [{ file: "src/api/routes.ts", startLine: 5 }],
          evidence: "some evidence",
          remediation: "fix it",
          confidence: 0.95,
        },
      ],
    };

    // raw text is ignored when structured is provided
    const result = parseAuditResponse(
      "ignored",
      SCAN_TASK,
      META.model,
      META.tokensUsed,
      META.durationMs,
      structured,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].ruleId).toBe("BAC-01");
    expect(result.findings[0].title).toBe("Structured output finding");
    expect(result.findings[0].confidence).toBe(0.95);
  });

  it("falls back to text parsing when structured is null", () => {
    const raw = JSON.stringify({
      findings: [
        {
          ruleId: "X-01",
          severity: "low",
          title: "text parsed",
          description: "",
          locations: [],
          evidence: "",
          remediation: "",
          confidence: 0.5,
        },
      ],
    });
    const result = parseAuditResponse(
      raw,
      SCAN_TASK,
      META.model,
      META.tokensUsed,
      META.durationMs,
      null,
    );
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0].title).toBe("text parsed");
  });
});
