import type { ComplianceReport, CorroboratedFinding } from "./findings";

// ── ANSI colors ──

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m",
};

function severityColor(severity: string): string {
  switch (severity) {
    case "critical":
      return c.red;
    case "high":
      return c.magenta;
    case "medium":
      return c.yellow;
    case "low":
      return c.blue;
    case "informational":
      return c.gray;
    default:
      return c.reset;
  }
}

function severityIcon(severity: string): string {
  switch (severity) {
    case "critical":
      return "!!";
    case "high":
      return "! ";
    case "medium":
      return "~ ";
    case "low":
      return ". ";
    case "informational":
      return "  ";
    default:
      return "  ";
  }
}

function pct(n: number): string {
  return `${(n * 100).toFixed(0)}%`;
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Terminal reporter ──

function formatFindingTerminal(cf: CorroboratedFinding): string {
  const f = cf.finding;
  const sev = f.severity.toUpperCase().padEnd(13);
  const conf = `${(cf.effectiveConfidence * 100).toFixed(0)}%`;
  const corr = cf.corroborations > 1 ? ` (x${cf.corroborations})` : "";
  const color = severityColor(f.severity);
  const icon = severityIcon(f.severity);

  const lines = [
    `${color}${icon}${c.bold}${sev}${c.reset} ${f.title}${c.dim}${corr}${c.reset}`,
    `${c.gray}   Rule: ${f.ruleId}  Confidence: ${conf}${c.reset}`,
  ];

  for (const loc of f.locations) {
    const end = loc.endLine ? `-${loc.endLine}` : "";
    lines.push(`${c.gray}   ${loc.file}:${loc.startLine}${end}${c.reset}`);
  }

  if (f.remediation) {
    lines.push(`${c.cyan}   Fix: ${f.remediation}${c.reset}`);
  }

  return lines.join("\n");
}

export function printComplianceReport(report: ComplianceReport): void {
  const { summary, scope, coverage, metadata } = report;
  const line = c.gray + "─".repeat(60) + c.reset;

  // Header
  console.log();
  const diffLabel = scope.diff
    ? ` ${c.cyan}(incremental: ${scope.diff.ref}, ${scope.diff.changedFiles} changed)${c.reset}`
    : "";
  console.log(`${c.bold}Compliance Audit Report${c.reset}${diffLabel}`);
  console.log(`${c.gray}${scope.ruleset} v${scope.rulesetVersion}${c.reset}`);
  console.log(
    `${c.gray}${scope.totalFiles} files across ${scope.components.length} components${c.reset}`,
  );
  console.log(line);

  // Summary bar
  const counts = [
    summary.critical > 0 ? `${c.red}${summary.critical} critical${c.reset}` : null,
    summary.high > 0 ? `${c.magenta}${summary.high} high${c.reset}` : null,
    summary.medium > 0 ? `${c.yellow}${summary.medium} medium${c.reset}` : null,
    summary.low > 0 ? `${c.blue}${summary.low} low${c.reset}` : null,
    summary.informational > 0 ? `${c.gray}${summary.informational} info${c.reset}` : null,
  ].filter(Boolean);

  if (summary.total === 0) {
    console.log(`\n${c.green}No compliance violations found.${c.reset}\n`);
  } else {
    console.log(`\n${c.bold}${summary.total} findings:${c.reset} ${counts.join("  ")}\n`);
  }

  // Findings
  if (report.findings.length > 0) {
    for (const cf of report.findings) {
      console.log(formatFindingTerminal(cf));
      console.log();
    }
    console.log(line);
  }

  // Coverage
  const unchecked = coverage.entries.filter((e) => !e.checked);
  if (unchecked.length > 0) {
    console.log(`\n${c.bold}Coverage gaps:${c.reset}`);
    for (const entry of unchecked) {
      console.log(
        `${c.yellow}  ? ${entry.component} / ${entry.ruleId}${c.gray} — ${entry.reason || "unknown"}${c.reset}`,
      );
    }
    console.log();
  }

  console.log(
    `${c.gray}Coverage: ${pct(coverage.componentCoverage)} components, ${pct(coverage.ruleCoverage)} rules${c.reset}`,
  );
  const suppressedStr = metadata.suppressedCount
    ? `  ${c.dim}(${metadata.suppressedCount} suppressed)${c.reset}`
    : "";
  console.log(
    `${c.gray}${metadata.tasksExecuted} tasks in ${duration(metadata.totalDurationMs)}, ${metadata.totalTokensUsed.toLocaleString()} tokens${c.reset}${suppressedStr}`,
  );
  console.log();
}

// ── Markdown reporter ──

function formatFindingMarkdown(cf: CorroboratedFinding): string {
  const f = cf.finding;
  const conf = `${(cf.effectiveConfidence * 100).toFixed(0)}%`;
  const corr = cf.corroborations > 1 ? ` (corroborated x${cf.corroborations})` : "";
  const sev = f.severity.toUpperCase();

  const lines = [
    `### ${sev}: ${f.title}${corr}`,
    "",
    `- **Rule:** ${f.ruleId}`,
    `- **Confidence:** ${conf}`,
  ];

  for (const loc of f.locations) {
    const end = loc.endLine ? `-${loc.endLine}` : "";
    lines.push(`- **Location:** \`${loc.file}:${loc.startLine}${end}\``);
  }

  if (f.description) {
    lines.push("", f.description);
  }

  if (f.evidence) {
    lines.push("", `**Evidence:** ${f.evidence}`);
  }

  if (f.remediation) {
    lines.push("", `**Remediation:** ${f.remediation}`);
  }

  return lines.join("\n");
}

export function generateComplianceMarkdown(report: ComplianceReport): string {
  const { summary, scope, coverage, metadata } = report;
  const lines: string[] = [];

  // Header
  lines.push(`# Compliance Audit Report`);
  lines.push("");
  lines.push(`| | |`);
  lines.push(`|---|---|`);
  lines.push(`| **Ruleset** | ${scope.ruleset} v${scope.rulesetVersion} |`);
  lines.push(`| **Files** | ${scope.totalFiles} across ${scope.components.length} components |`);
  if (scope.diff) {
    lines.push(
      `| **Scope** | Incremental (diff: ${scope.diff.ref}, ${scope.diff.changedFiles} changed files) |`,
    );
  }
  lines.push(`| **Date** | ${metadata.startedAt} |`);
  lines.push(`| **Duration** | ${duration(metadata.totalDurationMs)} |`);
  lines.push("");

  // Summary
  lines.push("## Summary");
  lines.push("");
  lines.push(`| Severity | Count |`);
  lines.push(`|----------|-------|`);
  if (summary.critical > 0) lines.push(`| Critical | ${summary.critical} |`);
  if (summary.high > 0) lines.push(`| High | ${summary.high} |`);
  if (summary.medium > 0) lines.push(`| Medium | ${summary.medium} |`);
  if (summary.low > 0) lines.push(`| Low | ${summary.low} |`);
  if (summary.informational > 0) lines.push(`| Informational | ${summary.informational} |`);
  lines.push(`| **Total** | **${summary.total}** |`);
  lines.push("");

  // Findings
  if (report.findings.length > 0) {
    lines.push("## Findings");
    lines.push("");
    for (const cf of report.findings) {
      lines.push(formatFindingMarkdown(cf));
      lines.push("");
      lines.push("---");
      lines.push("");
    }
  } else {
    lines.push("## Findings");
    lines.push("");
    lines.push("No compliance violations found.");
    lines.push("");
  }

  // Coverage
  lines.push("## Coverage");
  lines.push("");
  lines.push(`- **Components:** ${pct(coverage.componentCoverage)}`);
  lines.push(`- **Rules:** ${pct(coverage.ruleCoverage)}`);
  lines.push("");

  const unchecked = coverage.entries.filter((e) => !e.checked);
  if (unchecked.length > 0) {
    lines.push("### Gaps");
    lines.push("");
    lines.push("| Component | Rule | Reason |");
    lines.push("|-----------|------|--------|");
    for (const entry of unchecked) {
      lines.push(`| ${entry.component} | ${entry.ruleId} | ${entry.reason || "unknown"} |`);
    }
    lines.push("");
  }

  // Metadata
  lines.push("## Metadata");
  lines.push("");
  lines.push(`- **Tasks executed:** ${metadata.tasksExecuted} (${metadata.tasksFailed} failed)`);
  lines.push(`- **Tokens used:** ${metadata.totalTokensUsed.toLocaleString()}`);
  lines.push(`- **Models:** ${metadata.models.join(", ")}`);
  if (metadata.suppressedCount) {
    lines.push(`- **Suppressed:** ${metadata.suppressedCount} findings`);
  }
  lines.push("");

  return lines.join("\n");
}

// ── JSON reporter ──

export function generateComplianceJson(report: ComplianceReport): string {
  return JSON.stringify(report, null, 2);
}
