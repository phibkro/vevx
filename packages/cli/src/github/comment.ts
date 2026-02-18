import { agents, type AuditReport } from "@varp/audit";

/**
 * Format score as star rating (0-10 → 0-5 stars)
 */
function formatStars(score: number): string {
  const stars = Math.round(score / 2);
  return "⭐".repeat(stars);
}

/**
 * Format agent status based on score
 */
function formatAgentStatus(score: number): string {
  if (score >= 8) return "✅ Pass";
  if (score >= 6) return "⚠️ Review";
  return "❌ Needs Work";
}

/**
 * Format a finding for PR comment
 */
function formatFinding(finding: any, agentName: string, index: number): string {
  const severity = finding.severity.toUpperCase();
  const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;

  let result = `${index + 1}. **[${severity}]** ${finding.title}\n`;
  result += `   - **Location:** \`${location}\`\n`;
  result += `   - **Agent:** ${agentName}\n`;

  if (finding.suggestion) {
    result += `   - **Fix:** ${finding.suggestion}\n`;
  } else if (finding.description) {
    result += `   - **Details:** ${finding.description}\n`;
  }

  return result;
}

/**
 * Format full PR comment with report
 */
export function formatPRComment(report: AuditReport, isPublic: boolean): string {
  const { overallScore, agentResults, criticalCount, warningCount, infoCount } = report;

  // Header
  let comment = "## 🤖 AI Code Auditor Report\n\n";
  comment += `**Overall Score:** ${overallScore.toFixed(1)}/10 ${formatStars(overallScore)}\n\n`;

  // Summary counts
  comment += "### 📊 Findings Summary\n\n";
  if (criticalCount > 0) {
    comment += `- 🔴 **${criticalCount} Critical** issue${criticalCount !== 1 ? "s" : ""}\n`;
  }
  if (warningCount > 0) {
    comment += `- 🟡 **${warningCount} Warning${warningCount !== 1 ? "s" : ""}**\n`;
  }
  if (infoCount > 0) {
    comment += `- 🔵 **${infoCount} Info**\n`;
  }
  if (criticalCount === 0 && warningCount === 0 && infoCount === 0) {
    comment += "✅ No issues found!\n";
  }
  comment += "\n";

  // Agent breakdown (collapsible)
  comment += "<details>\n";
  comment += "<summary>📈 Agent Breakdown (click to expand)</summary>\n\n";
  comment += "| Agent | Score | Weight | Status |\n";
  comment += "|-------|-------|--------|--------|\n";

  agentResults.forEach((result) => {
    const agent = agents.find((a) => a.name === result.agent);
    const weight = agent ? `${(agent.weight * 100).toFixed(0)}%` : "N/A";
    const status = formatAgentStatus(result.score);

    comment += `| ${result.agent} | ${result.score.toFixed(1)}/10 | ${weight} | ${status} |\n`;
  });

  comment += "\n</details>\n\n";

  // Top recommendations (if any)
  if (report.topRecommendations.length > 0) {
    comment += "<details>\n";
    comment += "<summary>🎯 Top Recommendations (click to expand)</summary>\n\n";

    // Collect all findings sorted by severity
    const allFindings: Array<{
      finding: any;
      agentName: string;
    }> = [];

    agentResults.forEach((result) => {
      result.findings.forEach((finding) => {
        allFindings.push({
          finding,
          agentName: result.agent,
        });
      });
    });

    // Sort by severity (critical > warning > info)
    allFindings.sort((a, b) => {
      const severityOrder = { critical: 3, warning: 2, info: 1 };
      const aSeverity = severityOrder[a.finding.severity as keyof typeof severityOrder] || 0;
      const bSeverity = severityOrder[b.finding.severity as keyof typeof severityOrder] || 0;
      return bSeverity - aSeverity;
    });

    // Show top 5 findings
    const topFindings = allFindings.slice(0, 5);

    topFindings.forEach((item, index) => {
      comment += formatFinding(item.finding, item.agentName, index);
      comment += "\n";
    });

    if (allFindings.length > 5) {
      comment += `\n*... and ${allFindings.length - 5} more finding${allFindings.length - 5 !== 1 ? "s" : ""}*\n`;
    }

    comment += "\n</details>\n\n";
  }

  // Per-agent details (collapsible)
  comment += "<details>\n";
  comment += "<summary>🔍 Detailed Agent Reports (click to expand)</summary>\n\n";

  agentResults.forEach((result) => {
    comment += `### ${result.agent} - ${result.score.toFixed(1)}/10\n\n`;
    comment += `**Summary:** ${result.summary}\n\n`;

    if (result.findings.length > 0) {
      comment += `**Findings (${result.findings.length}):**\n\n`;
      result.findings.forEach((finding, index) => {
        comment += formatFinding(finding, result.agent, index);
      });
      comment += "\n";
    } else {
      comment += "✅ No issues found by this agent.\n\n";
    }
  });

  comment += "</details>\n\n";

  // Footer with CTA
  comment += "---\n\n";

  if (isPublic) {
    comment += "✨ **Free audit for public repos!** ";
    comment +=
      "[Add AI Code Auditor to your repo](https://github.com/marketplace/actions/ai-code-auditor)\n\n";
  } else {
    comment += "🔒 **Private repo audit** • ";
    comment +=
      "[Upgrade to Pro](https://github.com/marketplace/actions/ai-code-auditor) for unlimited private repo audits\n\n";
  }

  comment += "<sub>Powered by [AI Code Auditor](https://github.com/your-org/ai-code-auditor) • ";
  comment += "Multi-agent code analysis with Claude • ";
  comment += `Report generated at ${new Date().toISOString()}</sub>\n`;

  return comment;
}

/**
 * Format a minimal comment when audit fails
 */
export function formatErrorComment(error: string): string {
  let comment = "## 🤖 AI Code Auditor Report\n\n";
  comment += "❌ **Audit Failed**\n\n";
  comment += "The code audit could not be completed:\n\n";
  comment += "```\n";
  comment += error;
  comment += "\n```\n\n";
  comment += "---\n\n";
  comment +=
    "<sub>Powered by [AI Code Auditor](https://github.com/your-org/ai-code-auditor)</sub>\n";

  return comment;
}
