import { agents } from "../agents/index";
import type { AuditReport } from "./synthesizer";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

/**
 * Get color for score (0-10)
 */
function getScoreColor(score: number): string {
  if (score >= 8) return colors.green;
  if (score >= 6) return colors.yellow;
  return colors.red;
}

/**
 * Get color for severity
 */
function getSeverityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return colors.red;
    case "warning":
      return colors.yellow;
    case "info":
      return colors.blue;
    default:
      return colors.reset;
  }
}

/**
 * Generate star rating visual (out of 10)
 */
function getStarRating(score: number): string {
  const stars = Math.round(score / 2.5); // 0-10 → 0-4 stars
  return "⭐".repeat(Math.max(0, stars));
}

/**
 * Format duration in milliseconds to human readable
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/**
 * Print colored audit report to terminal
 */
export function printReport(report: AuditReport): void {
  // Header
  console.log();
  console.log(
    colors.bold +
      colors.cyan +
      "╔══════════════════════════════════════════════════════════╗" +
      colors.reset,
  );
  console.log(
    colors.bold +
      colors.cyan +
      "║           AI Code Auditor - Multi-Agent Report           ║" +
      colors.reset,
  );
  console.log(
    colors.bold +
      colors.cyan +
      "╚══════════════════════════════════════════════════════════╝" +
      colors.reset,
  );
  console.log();

  // Target and overall score
  console.log(colors.bold + "Target: " + colors.reset + report.target);
  const scoreColor = getScoreColor(report.overallScore);
  const stars = getStarRating(report.overallScore);
  console.log(
    colors.bold +
      "Overall Score: " +
      colors.reset +
      scoreColor +
      colors.bold +
      report.overallScore.toFixed(1) +
      "/10" +
      colors.reset +
      " " +
      stars,
  );
  console.log();

  // Separator
  console.log(
    colors.gray + "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" + colors.reset,
  );
  console.log();

  // Agent breakdown
  console.log(colors.bold + "📊 Agent Breakdown:" + colors.reset);
  console.log();

  report.agentResults.forEach((result) => {
    const agent = agents.find((a) => a.name === result.agent);
    const weight = agent ? (agent.weight * 100).toFixed(0) : "??";
    const scoreColor = getScoreColor(result.score);
    const status = result.score >= 7 ? "✓" : "⚠";
    const statusColor = result.score >= 7 ? colors.green : colors.yellow;

    console.log(
      statusColor +
        status +
        colors.reset +
        " " +
        colors.bold +
        result.agent.padEnd(15) +
        colors.reset +
        scoreColor +
        colors.bold +
        result.score.toFixed(1) +
        "/10" +
        colors.reset +
        colors.gray +
        "  (weight: " +
        weight +
        "%)" +
        colors.reset +
        colors.gray +
        "  [" +
        formatDuration(result.durationMs) +
        "]" +
        colors.reset,
    );
  });

  console.log();
  console.log(
    colors.gray + "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" + colors.reset,
  );
  console.log();

  // Findings summary
  console.log(colors.bold + "🔍 Findings Summary:" + colors.reset);
  console.log();
  console.log(colors.red + "🔴 Critical: " + colors.bold + report.criticalCount + colors.reset);
  console.log(colors.yellow + "🟡 Warnings: " + colors.bold + report.warningCount + colors.reset);
  console.log(colors.blue + "🔵 Info: " + colors.bold + report.infoCount + colors.reset);
  console.log();

  // Top recommendations
  if (report.topRecommendations.length > 0) {
    console.log(
      colors.gray + "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" + colors.reset,
    );
    console.log();
    console.log(colors.bold + "🎯 Top Recommendations:" + colors.reset);
    console.log();

    report.topRecommendations.forEach((rec, index) => {
      const lines = rec.split("\n");
      const firstLine = lines[0] || "";

      // Determine severity color from first line
      let severityColor = colors.reset;
      if (firstLine.includes("[CRITICAL]")) {
        severityColor = colors.red;
      } else if (firstLine.includes("[WARNING]")) {
        severityColor = colors.yellow;
      } else if (firstLine.includes("[INFO]")) {
        severityColor = colors.blue;
      }

      console.log(
        colors.bold +
          `${index + 1}. ` +
          severityColor +
          firstLine.replace(/^\[.*?\]\s*/, "") +
          colors.reset,
      );

      // Print remaining lines (location and suggestion)
      for (let i = 1; i < lines.length; i++) {
        console.log(colors.gray + "   " + lines[i] + colors.reset);
      }
      console.log();
    });
  }

  // Detailed findings
  console.log(
    colors.gray + "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" + colors.reset,
  );
  console.log();
  console.log(colors.bold + "📋 Detailed Findings:" + colors.reset);
  console.log();

  report.agentResults.forEach((result) => {
    if (result.findings.length === 0) {
      console.log(colors.green + `[${result.agent}] ✓ No issues found` + colors.reset);
      console.log();
      return;
    }

    console.log(colors.bold + `[${result.agent}]` + colors.reset);

    result.findings.forEach((finding) => {
      const severityColor = getSeverityColor(finding.severity);
      const severityLabel = finding.severity.toUpperCase();
      const icon =
        finding.severity === "critical" ? "🔴" : finding.severity === "warning" ? "🟡" : "🔵";

      console.log(
        severityColor +
          icon +
          " " +
          severityLabel +
          ": " +
          colors.bold +
          finding.title +
          colors.reset,
      );

      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      console.log(colors.gray + "   File: " + location + colors.reset);

      if (finding.description) {
        console.log(colors.gray + "   Description: " + finding.description + colors.reset);
      }

      if (finding.suggestion) {
        console.log(colors.cyan + "   Suggestion: " + finding.suggestion + colors.reset);
      }

      console.log();
    });
  });

  console.log(
    colors.gray + "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━" + colors.reset,
  );
  console.log();
}
