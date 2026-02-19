import type { AuditReport } from "../../index.js";

/**
 * Format audit report as Markdown for documentation
 */
export function formatMarkdown(report: AuditReport): string {
  let md = `# Code Audit Report\n\n`;
  md += `**Target:** ${report.target}\n`;
  md += `**Date:** ${new Date(report.timestamp).toLocaleString()}\n`;
  md += `**Overall Score:** ${report.overallScore.toFixed(1)}/10\n\n`;

  // Summary
  md += `## Summary\n\n`;
  md += `- **Critical Issues:** ${report.criticalCount}\n`;
  md += `- **Warnings:** ${report.warningCount}\n`;
  md += `- **Info:** ${report.infoCount}\n`;
  md += `- **Total Findings:** ${report.criticalCount + report.warningCount + report.infoCount}\n\n`;

  // Agent scores table
  md += `## Agent Results\n\n`;
  md += `| Agent | Score | Findings |\n`;
  md += `|-------|-------|----------|\n`;

  for (const result of report.agentResults) {
    const scoreBar = "\u2588".repeat(Math.round(result.score));
    md += `| ${result.agent} | ${scoreBar} ${result.score.toFixed(1)}/10 | ${result.findings.length} |\n`;
  }

  md += `\n`;

  // Top recommendations
  if (report.topRecommendations.length > 0) {
    md += `## Top Recommendations\n\n`;
    report.topRecommendations.forEach((rec, index) => {
      md += `${index + 1}. ${rec}\n\n`;
    });
  }

  // Detailed findings
  md += `## Detailed Findings\n\n`;

  for (const result of report.agentResults) {
    if (result.findings.length > 0) {
      md += `### ${result.agent} (${result.score.toFixed(1)}/10)\n\n`;

      for (const finding of result.findings) {
        const severityBadge =
          finding.severity === "critical"
            ? "\uD83D\uDD34 **CRITICAL**"
            : finding.severity === "warning"
              ? "\uD83D\uDFE1 **WARNING**"
              : "\uD83D\uDD35 **INFO**";

        md += `#### ${severityBadge}: ${finding.title}\n\n`;
        md += `**File:** \`${finding.file}\`${finding.line ? `:${finding.line}` : ""}\n\n`;
        md += `${finding.description}\n\n`;

        if (finding.suggestion) {
          md += `**Suggestion:** ${finding.suggestion}\n\n`;
        }

        md += `---\n\n`;
      }
    }
  }

  return md;
}
