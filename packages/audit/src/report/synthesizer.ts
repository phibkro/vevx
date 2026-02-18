import { agents } from "../agents/index";
import type { AgentResult } from "../agents/types";

export interface AuditReport {
  target: string; // file/directory audited
  overallScore: number; // weighted average (0-10)
  agentResults: AgentResult[];
  criticalCount: number; // count of critical findings
  warningCount: number; // count of warning findings
  infoCount: number; // count of info findings
  topRecommendations: string[]; // top 3-5 most important fixes
  timestamp: string; // ISO timestamp
}

/**
 * Synthesize agent results into a comprehensive audit report
 */
export function synthesizeReport(target: string, agentResults: AgentResult[]): AuditReport {
  // Calculate weighted average score
  let weightedSum = 0;
  let totalWeight = 0;

  agentResults.forEach((result) => {
    const agent = agents.find((a) => a.name === result.agent);
    if (agent) {
      weightedSum += result.score * agent.weight;
      totalWeight += agent.weight;
    }
  });

  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Count findings by severity
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;

  agentResults.forEach((result) => {
    result.findings.forEach((finding) => {
      switch (finding.severity) {
        case "critical":
          criticalCount++;
          break;
        case "warning":
          warningCount++;
          break;
        case "info":
          infoCount++;
          break;
      }
    });
  });

  // Extract top recommendations (prioritize critical > warning > info, limit to 5)
  interface ScoredFinding {
    finding: any;
    agentName: string;
    priority: number;
  }

  const scoredFindings: ScoredFinding[] = [];

  agentResults.forEach((result) => {
    result.findings.forEach((finding) => {
      // Priority: critical=3, warning=2, info=1
      const priority = finding.severity === "critical" ? 3 : finding.severity === "warning" ? 2 : 1;

      scoredFindings.push({
        finding,
        agentName: result.agent,
        priority,
      });
    });
  });

  // Sort by priority (highest first) and take top 5
  scoredFindings.sort((a, b) => b.priority - a.priority);

  const topRecommendations = scoredFindings.slice(0, 5).map((item) => {
    const { finding } = item;
    const severityLabel = finding.severity.toUpperCase();
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;

    let rec = `[${severityLabel}] ${finding.title}\n`;
    rec += `  → ${location}\n`;
    if (finding.suggestion) {
      rec += `  ${finding.suggestion}`;
    } else {
      rec += `  ${finding.description}`;
    }

    return rec;
  });

  return {
    target,
    overallScore,
    agentResults,
    criticalCount,
    warningCount,
    infoCount,
    topRecommendations,
    timestamp: new Date().toISOString(),
  };
}
