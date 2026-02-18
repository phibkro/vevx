import type { AuditFinding, CorroboratedFinding } from "../planner/findings";

export function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
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

export function makeCorroborated(
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
