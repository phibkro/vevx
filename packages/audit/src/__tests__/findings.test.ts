import { describe, expect, it } from "bun:test";

import {
  compareSeverity,
  findingsOverlap,
  deduplicateFindings,
  summarizeFindings,
} from "../planner/findings";
import type { AuditFinding, AuditTaskResult, AuditSeverity } from "../planner/findings";

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

function makeTaskResult(overrides: Partial<AuditTaskResult> = {}): AuditTaskResult {
  return {
    taskId: "scan-1",
    type: "component-scan",
    component: "src/api",
    rulesChecked: ["BAC-01"],
    findings: [],
    durationMs: 5000,
    model: "claude-sonnet-4-5-20250929",
    tokensUsed: 15000,
    ...overrides,
  };
}

// ── compareSeverity ──

describe("compareSeverity", () => {
  it("ranks critical < high < medium < low < informational", () => {
    const severities: AuditSeverity[] = ["informational", "low", "medium", "high", "critical"];
    const sorted = [...severities].sort(compareSeverity);
    expect(sorted).toEqual(["critical", "high", "medium", "low", "informational"]);
  });

  it("returns 0 for equal severities", () => {
    expect(compareSeverity("high", "high")).toBe(0);
  });

  it("returns negative when first is more severe", () => {
    expect(compareSeverity("critical", "low")).toBeLessThan(0);
  });
});

// ── findingsOverlap ──

describe("findingsOverlap", () => {
  it("detects same rule + same file + overlapping lines", () => {
    const a = makeFinding({ locations: [{ file: "a.ts", startLine: 10, endLine: 20 }] });
    const b = makeFinding({ locations: [{ file: "a.ts", startLine: 15, endLine: 25 }] });
    expect(findingsOverlap(a, b)).toBe(true);
  });

  it("detects same rule + same file + same line (single-line)", () => {
    const a = makeFinding({ locations: [{ file: "a.ts", startLine: 10 }] });
    const b = makeFinding({ locations: [{ file: "a.ts", startLine: 10 }] });
    expect(findingsOverlap(a, b)).toBe(true);
  });

  it("rejects different rules at same location", () => {
    const a = makeFinding({ ruleId: "BAC-01", locations: [{ file: "a.ts", startLine: 10 }] });
    const b = makeFinding({ ruleId: "INJ-01", locations: [{ file: "a.ts", startLine: 10 }] });
    expect(findingsOverlap(a, b)).toBe(false);
  });

  it("rejects same rule at different files", () => {
    const a = makeFinding({ locations: [{ file: "a.ts", startLine: 10 }] });
    const b = makeFinding({ locations: [{ file: "b.ts", startLine: 10 }] });
    expect(findingsOverlap(a, b)).toBe(false);
  });

  it("rejects same rule + same file but non-overlapping lines", () => {
    const a = makeFinding({ locations: [{ file: "a.ts", startLine: 10, endLine: 15 }] });
    const b = makeFinding({ locations: [{ file: "a.ts", startLine: 20, endLine: 25 }] });
    expect(findingsOverlap(a, b)).toBe(false);
  });

  it("handles multi-location findings (any overlap suffices)", () => {
    const a = makeFinding({
      locations: [
        { file: "a.ts", startLine: 1 },
        { file: "b.ts", startLine: 50 },
      ],
    });
    const b = makeFinding({
      locations: [{ file: "b.ts", startLine: 50 }],
    });
    expect(findingsOverlap(a, b)).toBe(true);
  });
});

// ── deduplicateFindings ──

describe("deduplicateFindings", () => {
  it("passes through unique findings unchanged", () => {
    const results: AuditTaskResult[] = [
      makeTaskResult({
        taskId: "scan-1",
        findings: [
          makeFinding({ ruleId: "BAC-01", locations: [{ file: "a.ts", startLine: 10 }] }),
          makeFinding({ ruleId: "INJ-01", locations: [{ file: "b.ts", startLine: 20 }] }),
        ],
      }),
    ];

    const deduped = deduplicateFindings(results);
    expect(deduped).toHaveLength(2);
    expect(deduped[0].corroborations).toBe(1);
    expect(deduped[1].corroborations).toBe(1);
  });

  it("merges duplicate findings from different tasks", () => {
    const finding1 = makeFinding({
      severity: "high",
      confidence: 0.8,
      locations: [{ file: "a.ts", startLine: 10 }],
    });
    const finding2 = makeFinding({
      severity: "critical",
      confidence: 0.9,
      locations: [{ file: "a.ts", startLine: 10 }],
    });

    const results: AuditTaskResult[] = [
      makeTaskResult({ taskId: "scan-1", findings: [finding1] }),
      makeTaskResult({ taskId: "scan-2", findings: [finding2] }),
    ];

    const deduped = deduplicateFindings(results);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].corroborations).toBe(2);
    expect(deduped[0].sourceTaskIds).toEqual(["scan-1", "scan-2"]);
    // Canonical should be the critical one (higher severity)
    expect(deduped[0].finding.severity).toBe("critical");
  });

  it("boosts confidence with corroborations", () => {
    const finding = makeFinding({ confidence: 0.7 });
    const results: AuditTaskResult[] = [
      makeTaskResult({ taskId: "scan-1", findings: [finding] }),
      makeTaskResult({ taskId: "scan-2", findings: [{ ...finding }] }),
      makeTaskResult({ taskId: "scan-3", findings: [{ ...finding }] }),
    ];

    const deduped = deduplicateFindings(results);
    expect(deduped).toHaveLength(1);
    // 0.7 + 0.1 * (3 - 1) = 0.9
    expect(deduped[0].effectiveConfidence).toBeCloseTo(0.9);
  });

  it("caps effective confidence at 1.0", () => {
    const finding = makeFinding({ confidence: 0.95 });
    const results: AuditTaskResult[] = [
      makeTaskResult({ taskId: "scan-1", findings: [finding] }),
      makeTaskResult({ taskId: "scan-2", findings: [{ ...finding }] }),
      makeTaskResult({ taskId: "scan-3", findings: [{ ...finding }] }),
    ];

    const deduped = deduplicateFindings(results);
    // 0.95 + 0.1 * 2 = 1.15, capped at 1.0
    expect(deduped[0].effectiveConfidence).toBe(1.0);
  });

  it("sorts output by severity then confidence", () => {
    const results: AuditTaskResult[] = [
      makeTaskResult({
        findings: [
          makeFinding({
            ruleId: "LOW-01",
            severity: "low",
            confidence: 0.9,
            locations: [{ file: "a.ts", startLine: 1 }],
          }),
          makeFinding({
            ruleId: "CRIT-01",
            severity: "critical",
            confidence: 0.7,
            locations: [{ file: "b.ts", startLine: 1 }],
          }),
          makeFinding({
            ruleId: "HIGH-01",
            severity: "high",
            confidence: 0.8,
            locations: [{ file: "c.ts", startLine: 1 }],
          }),
        ],
      }),
    ];

    const deduped = deduplicateFindings(results);
    expect(deduped[0].finding.severity).toBe("critical");
    expect(deduped[1].finding.severity).toBe("high");
    expect(deduped[2].finding.severity).toBe("low");
  });

  it("handles empty results", () => {
    expect(deduplicateFindings([])).toEqual([]);
  });

  it("handles results with no findings", () => {
    const results: AuditTaskResult[] = [
      makeTaskResult({ findings: [] }),
      makeTaskResult({ taskId: "scan-2", findings: [] }),
    ];
    expect(deduplicateFindings(results)).toEqual([]);
  });
});

// ── summarizeFindings ──

describe("summarizeFindings", () => {
  it("counts findings by severity", () => {
    const deduped = deduplicateFindings([
      makeTaskResult({
        findings: [
          makeFinding({
            ruleId: "A",
            severity: "critical",
            locations: [{ file: "a.ts", startLine: 1 }],
          }),
          makeFinding({
            ruleId: "B",
            severity: "critical",
            locations: [{ file: "b.ts", startLine: 1 }],
          }),
          makeFinding({
            ruleId: "C",
            severity: "high",
            locations: [{ file: "c.ts", startLine: 1 }],
          }),
          makeFinding({
            ruleId: "D",
            severity: "medium",
            locations: [{ file: "d.ts", startLine: 1 }],
          }),
          makeFinding({
            ruleId: "E",
            severity: "low",
            locations: [{ file: "e.ts", startLine: 1 }],
          }),
          makeFinding({
            ruleId: "F",
            severity: "informational",
            locations: [{ file: "f.ts", startLine: 1 }],
          }),
        ],
      }),
    ]);

    const summary = summarizeFindings(deduped);
    expect(summary.critical).toBe(2);
    expect(summary.high).toBe(1);
    expect(summary.medium).toBe(1);
    expect(summary.low).toBe(1);
    expect(summary.informational).toBe(1);
    expect(summary.total).toBe(6);
  });

  it("returns zeros for no findings", () => {
    const summary = summarizeFindings([]);
    expect(summary.total).toBe(0);
    expect(summary.critical).toBe(0);
  });
});
