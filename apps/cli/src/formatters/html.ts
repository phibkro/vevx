import type { AuditReport } from "../report/synthesizer";

/**
 * Format audit report as self-contained HTML for sharing
 */
export function formatHtml(report: AuditReport): string {
  const criticalFindings = report.agentResults.flatMap((r) =>
    r.findings.filter((f) => f.severity === "critical")
  );
  const warningFindings = report.agentResults.flatMap((r) =>
    r.findings.filter((f) => f.severity === "warning")
  );
  const infoFindings = report.agentResults.flatMap((r) =>
    r.findings.filter((f) => f.severity === "info")
  );

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Code Audit Report - ${report.target}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      max-width: 1200px;
      margin: 40px auto;
      padding: 0 20px;
      background: #f9fafb;
      color: #1f2937;
      line-height: 1.6;
    }
    .container {
      background: white;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    h1 { margin-top: 0; color: #111827; }
    h2 { color: #374151; border-bottom: 2px solid #e5e7eb; padding-bottom: 8px; margin-top: 32px; }
    h3 { color: #4b5563; }
    .score-card {
      display: flex;
      align-items: center;
      gap: 20px;
      margin: 24px 0;
      padding: 24px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      border-radius: 8px;
      color: white;
    }
    .score-number {
      font-size: 64px;
      font-weight: bold;
      line-height: 1;
    }
    .score-label { font-size: 14px; opacity: 0.9; }
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
      gap: 16px;
      margin: 24px 0;
    }
    .summary-item {
      padding: 16px;
      border-radius: 8px;
      text-align: center;
    }
    .summary-item.critical { background: #fef2f2; border: 1px solid #fecaca; }
    .summary-item.warning { background: #fffbeb; border: 1px solid #fed7aa; }
    .summary-item.info { background: #eff6ff; border: 1px solid #bfdbfe; }
    .summary-number { font-size: 32px; font-weight: bold; margin-bottom: 4px; }
    .summary-label { font-size: 14px; color: #6b7280; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 16px 0;
    }
    th, td {
      padding: 12px;
      text-align: left;
      border-bottom: 1px solid #e5e7eb;
    }
    th {
      background: #f9fafb;
      font-weight: 600;
      color: #374151;
    }
    .score-bar {
      display: inline-block;
      width: 100px;
      height: 8px;
      background: #e5e7eb;
      border-radius: 4px;
      overflow: hidden;
      margin-right: 8px;
      vertical-align: middle;
    }
    .score-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #10b981 0%, #059669 100%);
      transition: width 0.3s ease;
    }
    .finding {
      margin: 16px 0;
      padding: 16px;
      border-left: 4px solid #6b7280;
      background: #f9fafb;
      border-radius: 4px;
    }
    .finding.critical { border-left-color: #dc2626; background: #fef2f2; }
    .finding.warning { border-left-color: #ea580c; background: #fffbeb; }
    .finding.info { border-left-color: #2563eb; background: #eff6ff; }
    .finding-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .severity-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }
    .severity-badge.critical { background: #dc2626; color: white; }
    .severity-badge.warning { background: #ea580c; color: white; }
    .severity-badge.info { background: #2563eb; color: white; }
    .finding-title { font-weight: 600; flex: 1; }
    .finding-file {
      font-family: 'Monaco', 'Courier New', monospace;
      font-size: 13px;
      color: #6b7280;
      margin-bottom: 8px;
    }
    .finding-description { color: #4b5563; margin-bottom: 8px; }
    .finding-suggestion {
      padding: 12px;
      background: white;
      border-radius: 4px;
      border-left: 3px solid #10b981;
      margin-top: 8px;
    }
    .metadata {
      color: #6b7280;
      font-size: 14px;
      margin-top: 32px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
    }
    details { margin: 16px 0; }
    summary {
      cursor: pointer;
      font-weight: 600;
      padding: 8px;
      background: #f9fafb;
      border-radius: 4px;
    }
    summary:hover { background: #f3f4f6; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Code Audit Report</h1>

    <div class="score-card">
      <div>
        <div class="score-number">${report.overallScore.toFixed(1)}</div>
        <div class="score-label">/ 10</div>
      </div>
      <div>
        <div style="font-size: 20px; font-weight: 600; margin-bottom: 4px;">Overall Score</div>
        <div style="font-size: 14px; opacity: 0.9;">Target: ${report.target}</div>
        <div style="font-size: 12px; opacity: 0.8; margin-top: 4px;">
          ${new Date(report.timestamp).toLocaleString()}
        </div>
      </div>
    </div>

    <div class="summary-grid">
      <div class="summary-item critical">
        <div class="summary-number" style="color: #dc2626;">${report.criticalCount}</div>
        <div class="summary-label">Critical Issues</div>
      </div>
      <div class="summary-item warning">
        <div class="summary-number" style="color: #ea580c;">${report.warningCount}</div>
        <div class="summary-label">Warnings</div>
      </div>
      <div class="summary-item info">
        <div class="summary-number" style="color: #2563eb;">${report.infoCount}</div>
        <div class="summary-label">Info</div>
      </div>
    </div>

    <h2>Agent Results</h2>
    <table>
      <thead>
        <tr>
          <th>Agent</th>
          <th>Score</th>
          <th>Findings</th>
          <th>Duration</th>
        </tr>
      </thead>
      <tbody>
        ${report.agentResults
          .map(
            (result) => `
        <tr>
          <td>${result.agent}</td>
          <td>
            <div class="score-bar">
              <div class="score-bar-fill" style="width: ${(result.score / 10) * 100}%"></div>
            </div>
            ${result.score.toFixed(1)}/10
          </td>
          <td>${result.findings.length}</td>
          <td>${(result.durationMs / 1000).toFixed(1)}s</td>
        </tr>
        `
          )
          .join("")}
      </tbody>
    </table>

    ${
      report.topRecommendations.length > 0
        ? `
    <h2>Top Recommendations</h2>
    <ol>
      ${report.topRecommendations
        .map(
          (rec) => `
        <li style="margin-bottom: 12px;">${rec.replace(/\n/g, "<br>")}</li>
      `
        )
        .join("")}
    </ol>
    `
        : ""
    }

    <h2>Detailed Findings</h2>

    ${
      criticalFindings.length > 0
        ? `
    <details open>
      <summary>Critical Issues (${criticalFindings.length})</summary>
      ${criticalFindings
        .map(
          (finding) => `
      <div class="finding critical">
        <div class="finding-header">
          <span class="severity-badge critical">Critical</span>
          <span class="finding-title">${finding.title}</span>
        </div>
        <div class="finding-file">${finding.file}${finding.line ? `:${finding.line}` : ""}</div>
        <div class="finding-description">${finding.description}</div>
        ${
          finding.suggestion
            ? `<div class="finding-suggestion"><strong>Suggestion:</strong> ${finding.suggestion}</div>`
            : ""
        }
      </div>
      `
        )
        .join("")}
    </details>
    `
        : ""
    }

    ${
      warningFindings.length > 0
        ? `
    <details>
      <summary>Warnings (${warningFindings.length})</summary>
      ${warningFindings
        .map(
          (finding) => `
      <div class="finding warning">
        <div class="finding-header">
          <span class="severity-badge warning">Warning</span>
          <span class="finding-title">${finding.title}</span>
        </div>
        <div class="finding-file">${finding.file}${finding.line ? `:${finding.line}` : ""}</div>
        <div class="finding-description">${finding.description}</div>
        ${
          finding.suggestion
            ? `<div class="finding-suggestion"><strong>Suggestion:</strong> ${finding.suggestion}</div>`
            : ""
        }
      </div>
      `
        )
        .join("")}
    </details>
    `
        : ""
    }

    ${
      infoFindings.length > 0
        ? `
    <details>
      <summary>Info (${infoFindings.length})</summary>
      ${infoFindings
        .map(
          (finding) => `
      <div class="finding info">
        <div class="finding-header">
          <span class="severity-badge info">Info</span>
          <span class="finding-title">${finding.title}</span>
        </div>
        <div class="finding-file">${finding.file}${finding.line ? `:${finding.line}` : ""}</div>
        <div class="finding-description">${finding.description}</div>
        ${
          finding.suggestion
            ? `<div class="finding-suggestion"><strong>Suggestion:</strong> ${finding.suggestion}</div>`
            : ""
        }
      </div>
      `
        )
        .join("")}
    </details>
    `
        : ""
    }

    <div class="metadata">
      Generated by AI Code Auditor | ${new Date(report.timestamp).toLocaleString()}
    </div>
  </div>
</body>
</html>`;
}
