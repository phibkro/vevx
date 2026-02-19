import type { AuditReport } from "../../index.js";

/**
 * Format audit report as JSON for CI/CD integration
 */
export function formatJson(report: AuditReport): string {
  return JSON.stringify(
    {
      timestamp: report.timestamp,
      target: report.target,
      overallScore: report.overallScore,
      summary: {
        critical: report.criticalCount,
        warning: report.warningCount,
        info: report.infoCount,
        total: report.criticalCount + report.warningCount + report.infoCount,
      },
      agents: report.agentResults.map((result) => ({
        name: result.agent,
        score: result.score,
        duration: result.durationMs / 1000,
        findings: result.findings.map((finding) => ({
          severity: finding.severity,
          title: finding.title,
          description: finding.description,
          file: finding.file,
          line: finding.line,
          suggestion: finding.suggestion,
        })),
      })),
      topRecommendations: report.topRecommendations,
    },
    null,
    2,
  );
}
