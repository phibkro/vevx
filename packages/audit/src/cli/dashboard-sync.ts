import type { AuditReport } from "../index.js";
import { getApiKey } from "./auth.js";

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
    const opts = { stdout: "pipe" as const, stderr: "ignore" as const };

    const repo = Bun.spawnSync(["git", "config", "--get", "remote.origin.url"], opts);
    const commit = Bun.spawnSync(["git", "rev-parse", "HEAD"], opts);
    const branch = Bun.spawnSync(["git", "rev-parse", "--abbrev-ref", "HEAD"], opts);

    return {
      repo: repo.success ? repo.stdout.toString("utf-8").trim() : undefined,
      commit: commit.success ? commit.stdout.toString("utf-8").trim() : undefined,
      branch: branch.success ? branch.stdout.toString("utf-8").trim() : undefined,
    };
  } catch {
    // Not a git repository or git not available
    return {};
  }
}

/**
 * Send audit results to the web dashboard
 */
export async function syncToDashboard(
  report: AuditReport,
  durationMs: number,
): Promise<DashboardResponse | null> {
  const authConfig = getApiKey();

  if (!authConfig) {
    // Silently skip if no API key configured
    return null;
  }

  const { apiKey, apiUrl } = authConfig;

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
      })),
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

      if (response.status === 401) {
        console.error("\nDashboard sync failed: Invalid API key");
        console.error("  Your CODE_AUDITOR_API_KEY is invalid or expired.");
        console.error("  Run 'varp-audit login' to reconfigure.\n");
      } else if (response.status === 429) {
        console.error("\nDashboard sync failed: Rate limit or monthly quota exceeded");
        console.error("  View your plan at: https://code-auditor.com/team");
        console.error("  Upgrade at: https://code-auditor.com/pricing\n");
      } else {
        console.error(`\nDashboard sync failed: ${response.status} ${error}\n`);
      }

      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(
      "Error syncing to dashboard:",
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}
