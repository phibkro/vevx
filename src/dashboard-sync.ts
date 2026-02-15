import type { AuditReport } from "./report/synthesizer.ts";

interface DashboardConfig {
  apiKey: string;
  apiUrl: string;
}

interface DashboardResponse {
  auditId: string;
  teamId: string;
  dashboardUrl: string;
}

/**
 * Get git repository information
 */
function getGitInfo(): { repo?: string; commit?: string; branch?: string } {
  try {
    const { execSync } = require("child_process");

    const repo = execSync("git config --get remote.origin.url", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    const commit = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    return { repo, commit, branch };
  } catch (error) {
    // Not a git repository or git not available
    return {};
  }
}

/**
 * Send audit results to the web dashboard
 */
export async function syncToDashboard(
  report: AuditReport,
  durationMs: number
): Promise<DashboardResponse | null> {
  const apiKey = process.env.CODE_AUDITOR_API_KEY;
  const apiUrl = process.env.CODE_AUDITOR_API_URL || "https://code-auditor.com";

  if (!apiKey) {
    // Silently skip if no API key configured
    return null;
  }

  try {
    const gitInfo = getGitInfo();

    // Convert findings to API format
    const findings = report.agentResults.flatMap((result) =>
      result.findings.map((finding) => ({
        agent: result.agent,
        severity: finding.severity.toUpperCase() as "CRITICAL" | "WARNING" | "INFO",
        title: finding.title,
        description: finding.description,
        file: finding.file,
        line: finding.line,
        suggestion: finding.suggestion,
      }))
    );

    const payload = {
      repo: gitInfo.repo,
      commit: gitInfo.commit,
      branch: gitInfo.branch,
      overallScore: report.overallScore * 10, // Convert 0-10 to 0-100
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
      infoCount: report.infoCount,
      durationMs,
      findings,
    };

    const response = await fetch(`${apiUrl}/api/cli/audit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error(`Failed to sync to dashboard: ${response.status} ${error}`);
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error("Error syncing to dashboard:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
