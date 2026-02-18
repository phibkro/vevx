import {
  diffReports,
  printDriftReport,
  generateDriftMarkdown,
  generateDriftJson,
} from "../planner/drift";
import type { DriftReport } from "../planner/drift";
import type { AuditFinding, ComplianceReport, CorroboratedFinding } from "../planner/findings";

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    ruleId: "BAC-01",
    severity: "high",
    title: "Missing auth check",
    description: "Endpoint lacks authorization",
    locations: [{ file: "src/api/routes.ts", startLine: 10 }],
    evidence: 'app.get("/users/:id", (req, res) => { ... })',
    remediation: "Add auth middleware",
    confidence: 0.85,
    ...overrides,
  };
}

function makeCorroborated(
  overrides: Partial<AuditFinding> = {},
  corr: Partial<CorroboratedFinding> = {},
): CorroboratedFinding {
  const finding = makeFinding(overrides);
  return {
    finding,
    corroborations: 1,
    sourceTaskIds: ["scan-1"],
    effectiveConfidence: finding.confidence,
    ...corr,
  };
}

function makeReport(
  findings: CorroboratedFinding[],
  overrides: Partial<ComplianceReport> = {},
): ComplianceReport {
  return {
    scope: {
      ruleset: "OWASP Top 10",
      rulesetVersion: "1.0",
      components: ["src/api"],
      totalFiles: 5,
    },
    findings,
    summary: {
      critical: 0,
      high: findings.length,
      medium: 0,
      low: 0,
      informational: 0,
      total: findings.length,
    },
    coverage: {
      entries: [],
      componentCoverage: 1,
      ruleCoverage: 1,
    },
    metadata: {
      startedAt: "2025-01-01T00:00:00Z",
      completedAt: "2025-01-01T00:01:00Z",
      totalDurationMs: 60000,
      tasksExecuted: 1,
      tasksFailed: 0,
      totalTokensUsed: 10000,
      models: ["claude-sonnet-4-5-20250929"],
    },
    ...overrides,
  };
}

// ── diffReports ──

describe("diffReports", () => {
  it("detects same finding in both reports (no change)", () => {
    const finding = makeCorroborated();
    const baseline = makeReport([finding]);
    const current = makeReport([finding]);

    const drift = diffReports(baseline, current);
    expect(drift.new).toHaveLength(0);
    expect(drift.resolved).toHaveLength(0);
    expect(drift.changed).toHaveLength(0);
    expect(drift.summary.trend).toBe("stable");
  });

  it("detects new findings (only in current)", () => {
    const baseline = makeReport([]);
    const finding = makeCorroborated({
      ruleId: "INJ-01",
      locations: [{ file: "src/db.ts", startLine: 20 }],
    });
    const current = makeReport([finding]);

    const drift = diffReports(baseline, current);
    expect(drift.new).toHaveLength(1);
    expect(drift.new[0].type).toBe("new");
    expect(drift.new[0].finding.finding.ruleId).toBe("INJ-01");
    expect(drift.resolved).toHaveLength(0);
    expect(drift.summary.trend).toBe("regressing");
  });

  it("detects resolved findings (only in baseline)", () => {
    const finding = makeCorroborated();
    const baseline = makeReport([finding]);
    const current = makeReport([]);

    const drift = diffReports(baseline, current);
    expect(drift.resolved).toHaveLength(1);
    expect(drift.resolved[0].type).toBe("resolved");
    expect(drift.resolved[0].finding.finding.ruleId).toBe("BAC-01");
    expect(drift.new).toHaveLength(0);
    expect(drift.summary.trend).toBe("improving");
  });

  it("detects changed severity", () => {
    const baseFinding = makeCorroborated({ severity: "high" });
    const currFinding = makeCorroborated({ severity: "critical" });
    const baseline = makeReport([baseFinding]);
    const current = makeReport([currFinding]);

    const drift = diffReports(baseline, current);
    expect(drift.changed).toHaveLength(1);
    expect(drift.changed[0].type).toBe("changed");
    expect(drift.changed[0].changes).toContainEqual({
      field: "severity",
      old: "high",
      new: "critical",
    });
    expect(drift.new).toHaveLength(0);
    expect(drift.resolved).toHaveLength(0);
  });

  it("detects changed effectiveConfidence", () => {
    const baseFinding = makeCorroborated({}, { effectiveConfidence: 0.7 });
    const currFinding = makeCorroborated({}, { effectiveConfidence: 0.9 });
    const baseline = makeReport([baseFinding]);
    const current = makeReport([currFinding]);

    const drift = diffReports(baseline, current);
    expect(drift.changed).toHaveLength(1);
    expect(drift.changed[0].changes).toContainEqual({
      field: "effectiveConfidence",
      old: "0.70",
      new: "0.90",
    });
  });

  it("matches findings with slight line shift (overlapping range)", () => {
    const baseFinding = makeCorroborated({
      locations: [{ file: "src/api/routes.ts", startLine: 10, endLine: 15 }],
    });
    const currFinding = makeCorroborated({
      locations: [{ file: "src/api/routes.ts", startLine: 12, endLine: 17 }],
    });
    const baseline = makeReport([baseFinding]);
    const current = makeReport([currFinding]);

    const drift = diffReports(baseline, current);
    // Should match via findingsOverlap (overlapping line ranges)
    expect(drift.new).toHaveLength(0);
    expect(drift.resolved).toHaveLength(0);
  });

  it("does not match findings that moved to non-overlapping lines", () => {
    const baseFinding = makeCorroborated({
      locations: [{ file: "src/api/routes.ts", startLine: 10, endLine: 15 }],
    });
    const currFinding = makeCorroborated({
      locations: [{ file: "src/api/routes.ts", startLine: 100, endLine: 105 }],
    });
    const baseline = makeReport([baseFinding]);
    const current = makeReport([currFinding]);

    const drift = diffReports(baseline, current);
    expect(drift.new).toHaveLength(1);
    expect(drift.resolved).toHaveLength(1);
  });

  it("calculates improving trend (more resolved than new)", () => {
    const f1 = makeCorroborated({ ruleId: "A", locations: [{ file: "a.ts", startLine: 1 }] });
    const f2 = makeCorroborated({ ruleId: "B", locations: [{ file: "b.ts", startLine: 1 }] });
    const f3 = makeCorroborated({ ruleId: "C", locations: [{ file: "c.ts", startLine: 1 }] });
    const baseline = makeReport([f1, f2, f3]);
    const current = makeReport([f1]); // resolved f2 and f3

    const drift = diffReports(baseline, current);
    expect(drift.summary.resolvedCount).toBe(2);
    expect(drift.summary.newCount).toBe(0);
    expect(drift.summary.trend).toBe("improving");
  });

  it("handles both reports empty (stable)", () => {
    const baseline = makeReport([]);
    const current = makeReport([]);

    const drift = diffReports(baseline, current);
    expect(drift.new).toHaveLength(0);
    expect(drift.resolved).toHaveLength(0);
    expect(drift.changed).toHaveLength(0);
    expect(drift.summary.trend).toBe("stable");
  });

  it("populates baseline and current metadata", () => {
    const baseline = makeReport([], {
      metadata: {
        startedAt: "2025-01-01T00:00:00Z",
        completedAt: "2025-01-01T00:01:00Z",
        totalDurationMs: 60000,
        tasksExecuted: 1,
        tasksFailed: 0,
        totalTokensUsed: 10000,
        models: ["claude-sonnet-4-5-20250929"],
      },
    });
    const current = makeReport([], {
      metadata: {
        startedAt: "2025-02-01T00:00:00Z",
        completedAt: "2025-02-01T00:01:00Z",
        totalDurationMs: 60000,
        tasksExecuted: 1,
        tasksFailed: 0,
        totalTokensUsed: 10000,
        models: ["claude-sonnet-4-5-20250929"],
      },
    });

    const drift = diffReports(baseline, current);
    expect(drift.baseline.startedAt).toBe("2025-01-01T00:00:00Z");
    expect(drift.current.startedAt).toBe("2025-02-01T00:00:00Z");
    expect(drift.baseline.ruleset).toBe("OWASP Top 10");
  });

  it("handles multiple findings with mixed changes", () => {
    const shared = makeCorroborated({ ruleId: "A", locations: [{ file: "a.ts", startLine: 1 }] });
    const baseOnly = makeCorroborated({ ruleId: "B", locations: [{ file: "b.ts", startLine: 1 }] });
    const currOnly = makeCorroborated({ ruleId: "C", locations: [{ file: "c.ts", startLine: 1 }] });

    const baseline = makeReport([shared, baseOnly]);
    const current = makeReport([shared, currOnly]);

    const drift = diffReports(baseline, current);
    expect(drift.new).toHaveLength(1);
    expect(drift.new[0].finding.finding.ruleId).toBe("C");
    expect(drift.resolved).toHaveLength(1);
    expect(drift.resolved[0].finding.finding.ruleId).toBe("B");
    expect(drift.summary.trend).toBe("stable"); // 1 new, 1 resolved
  });
});

// ── Renderers ──

describe("printDriftReport", () => {
  it("produces terminal output with trend", () => {
    const drift = diffReports(makeReport([]), makeReport([]));
    const output = printDriftReport(drift);
    expect(output).toContain("Compliance Drift Report");
    expect(output).toContain("stable");
    expect(output).toContain("No changes detected");
  });

  it("shows new and resolved findings", () => {
    const finding = makeCorroborated();
    const drift = diffReports(makeReport([]), makeReport([finding]));
    const output = printDriftReport(drift);
    expect(output).toContain("New findings (1)");
    expect(output).toContain("BAC-01");
  });
});

describe("generateDriftMarkdown", () => {
  it("produces markdown with table", () => {
    const drift = diffReports(makeReport([]), makeReport([]));
    const md = generateDriftMarkdown(drift);
    expect(md).toContain("# Compliance Drift Report");
    expect(md).toContain("| **Date**");
    expect(md).toContain("stable");
  });

  it("includes new findings section", () => {
    const finding = makeCorroborated();
    const drift = diffReports(makeReport([]), makeReport([finding]));
    const md = generateDriftMarkdown(drift);
    expect(md).toContain("## New Findings");
    expect(md).toContain("BAC-01");
  });
});

describe("generateDriftJson", () => {
  it("produces valid JSON", () => {
    const drift = diffReports(makeReport([]), makeReport([]));
    const json = generateDriftJson(drift);
    const parsed = JSON.parse(json) as DriftReport;
    expect(parsed.summary.trend).toBe("stable");
    expect(parsed.new).toEqual([]);
  });
});
