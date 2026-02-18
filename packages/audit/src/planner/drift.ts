import type { AuditSeverity, ComplianceReport, CorroboratedFinding } from './findings';
import { findingsOverlap } from './findings';

// ── Types ──

export interface FindingChange {
  type: 'new' | 'resolved' | 'changed';
  finding: CorroboratedFinding;
  /** Previous version (for 'resolved' and 'changed') */
  previous?: CorroboratedFinding;
  /** What changed (for 'changed' only) */
  changes?: { field: string; old: string; new: string }[];
}

export interface DriftSummary {
  newCount: number;
  resolvedCount: number;
  changedCount: number;
  trend: 'improving' | 'stable' | 'regressing';
}

export interface DriftReport {
  baseline: { startedAt: string; ruleset: string; totalFindings: number };
  current: { startedAt: string; ruleset: string; totalFindings: number };
  new: FindingChange[];
  resolved: FindingChange[];
  changed: FindingChange[];
  summary: DriftSummary;
}

// ── Diff logic ──

/**
 * Compare two compliance reports and produce a drift report.
 *
 * Uses `findingsOverlap()` for finding identity — same ruleId + overlapping
 * file/line range. This is the same logic used for within-run deduplication.
 */
export function diffReports(
  baseline: ComplianceReport,
  current: ComplianceReport,
): DriftReport {
  const matched = new Set<number>(); // indices into baseline.findings that matched
  const newFindings: FindingChange[] = [];
  const changedFindings: FindingChange[] = [];

  // For each current finding, search baseline for a match
  for (const curr of current.findings) {
    let foundMatch = false;

    for (let i = 0; i < baseline.findings.length; i++) {
      if (matched.has(i)) continue;

      const base = baseline.findings[i];
      if (findingsOverlap(curr.finding, base.finding)) {
        matched.add(i);
        foundMatch = true;

        // Check for severity or confidence changes
        const changes: { field: string; old: string; new: string }[] = [];
        if (curr.finding.severity !== base.finding.severity) {
          changes.push({
            field: 'severity',
            old: base.finding.severity,
            new: curr.finding.severity,
          });
        }
        if (curr.effectiveConfidence !== base.effectiveConfidence) {
          changes.push({
            field: 'effectiveConfidence',
            old: base.effectiveConfidence.toFixed(2),
            new: curr.effectiveConfidence.toFixed(2),
          });
        }

        if (changes.length > 0) {
          changedFindings.push({
            type: 'changed',
            finding: curr,
            previous: base,
            changes,
          });
        }
        break;
      }
    }

    if (!foundMatch) {
      newFindings.push({ type: 'new', finding: curr });
    }
  }

  // Unmatched baseline findings are resolved
  const resolvedFindings: FindingChange[] = [];
  for (let i = 0; i < baseline.findings.length; i++) {
    if (!matched.has(i)) {
      resolvedFindings.push({
        type: 'resolved',
        finding: baseline.findings[i],
        previous: baseline.findings[i],
      });
    }
  }

  const newCount = newFindings.length;
  const resolvedCount = resolvedFindings.length;
  const changedCount = changedFindings.length;

  let trend: DriftSummary['trend'];
  if (resolvedCount > newCount) trend = 'improving';
  else if (newCount > resolvedCount) trend = 'regressing';
  else trend = 'stable';

  return {
    baseline: {
      startedAt: baseline.metadata.startedAt,
      ruleset: baseline.scope.ruleset,
      totalFindings: baseline.findings.length,
    },
    current: {
      startedAt: current.metadata.startedAt,
      ruleset: current.scope.ruleset,
      totalFindings: current.findings.length,
    },
    new: newFindings,
    resolved: resolvedFindings,
    changed: changedFindings,
    summary: { newCount, resolvedCount, changedCount, trend },
  };
}

// ── Renderers ──

const SEVERITY_COLORS: Record<AuditSeverity, string> = {
  critical: '\x1b[31m',  // red
  high: '\x1b[91m',      // bright red
  medium: '\x1b[33m',    // yellow
  low: '\x1b[36m',       // cyan
  informational: '\x1b[90m', // gray
};
const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';

function trendIcon(trend: DriftSummary['trend']): string {
  if (trend === 'improving') return `${GREEN}↓ improving${RESET}`;
  if (trend === 'regressing') return `${RED}↑ regressing${RESET}`;
  return `${BOLD}→ stable${RESET}`;
}

function formatFindingLine(cf: CorroboratedFinding): string {
  const loc = cf.finding.locations[0];
  const locStr = loc ? `${loc.file}:${loc.startLine}` : 'unknown';
  const color = SEVERITY_COLORS[cf.finding.severity];
  return `  ${color}[${cf.finding.severity.toUpperCase()}]${RESET} ${cf.finding.ruleId}: ${cf.finding.title} (${locStr})`;
}

/**
 * Print a drift report to the terminal with ANSI colors.
 */
export function printDriftReport(drift: DriftReport): string {
  const lines: string[] = [];

  lines.push(`${BOLD}Compliance Drift Report${RESET}`);
  lines.push(`Baseline: ${drift.baseline.startedAt} (${drift.baseline.totalFindings} findings)`);
  lines.push(`Current:  ${drift.current.startedAt} (${drift.current.totalFindings} findings)`);
  lines.push(`Trend:    ${trendIcon(drift.summary.trend)}`);
  lines.push('');

  if (drift.new.length > 0) {
    lines.push(`${RED}${BOLD}New findings (${drift.new.length}):${RESET}`);
    for (const change of drift.new) {
      lines.push(formatFindingLine(change.finding));
    }
    lines.push('');
  }

  if (drift.resolved.length > 0) {
    lines.push(`${GREEN}${BOLD}Resolved findings (${drift.resolved.length}):${RESET}`);
    for (const change of drift.resolved) {
      lines.push(formatFindingLine(change.finding));
    }
    lines.push('');
  }

  if (drift.changed.length > 0) {
    lines.push(`${BOLD}Changed findings (${drift.changed.length}):${RESET}`);
    for (const change of drift.changed) {
      lines.push(formatFindingLine(change.finding));
      for (const c of change.changes ?? []) {
        lines.push(`    ${c.field}: ${c.old} → ${c.new}`);
      }
    }
    lines.push('');
  }

  if (drift.new.length === 0 && drift.resolved.length === 0 && drift.changed.length === 0) {
    lines.push('No changes detected.');
    lines.push('');
  }

  lines.push(
    `Summary: +${drift.summary.newCount} new, -${drift.summary.resolvedCount} resolved, ~${drift.summary.changedCount} changed`,
  );

  return lines.join('\n');
}

/**
 * Generate a drift report in markdown format.
 */
export function generateDriftMarkdown(drift: DriftReport): string {
  const lines: string[] = [];

  lines.push('# Compliance Drift Report');
  lines.push('');
  lines.push(`| | Baseline | Current |`);
  lines.push(`|---|---|---|`);
  lines.push(`| **Date** | ${drift.baseline.startedAt} | ${drift.current.startedAt} |`);
  lines.push(`| **Ruleset** | ${drift.baseline.ruleset} | ${drift.current.ruleset} |`);
  lines.push(`| **Findings** | ${drift.baseline.totalFindings} | ${drift.current.totalFindings} |`);
  lines.push('');

  const trendEmoji =
    drift.summary.trend === 'improving' ? '📉' :
    drift.summary.trend === 'regressing' ? '📈' : '➡️';
  lines.push(`**Trend:** ${trendEmoji} ${drift.summary.trend}`);
  lines.push('');

  if (drift.new.length > 0) {
    lines.push('## New Findings');
    lines.push('');
    for (const change of drift.new) {
      const f = change.finding.finding;
      const loc = f.locations[0];
      lines.push(`- **[${f.severity.toUpperCase()}]** \`${f.ruleId}\`: ${f.title} (${loc?.file}:${loc?.startLine})`);
    }
    lines.push('');
  }

  if (drift.resolved.length > 0) {
    lines.push('## Resolved Findings');
    lines.push('');
    for (const change of drift.resolved) {
      const f = change.finding.finding;
      const loc = f.locations[0];
      lines.push(`- ~~**[${f.severity.toUpperCase()}]** \`${f.ruleId}\`: ${f.title} (${loc?.file}:${loc?.startLine})~~`);
    }
    lines.push('');
  }

  if (drift.changed.length > 0) {
    lines.push('## Changed Findings');
    lines.push('');
    for (const change of drift.changed) {
      const f = change.finding.finding;
      const loc = f.locations[0];
      lines.push(`- **[${f.severity.toUpperCase()}]** \`${f.ruleId}\`: ${f.title} (${loc?.file}:${loc?.startLine})`);
      for (const c of change.changes ?? []) {
        lines.push(`  - ${c.field}: ${c.old} → ${c.new}`);
      }
    }
    lines.push('');
  }

  lines.push('## Summary');
  lines.push('');
  lines.push(`| Metric | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| New | ${drift.summary.newCount} |`);
  lines.push(`| Resolved | ${drift.summary.resolvedCount} |`);
  lines.push(`| Changed | ${drift.summary.changedCount} |`);

  return lines.join('\n');
}

/**
 * Generate a drift report as a JSON string.
 */
export function generateDriftJson(drift: DriftReport): string {
  return JSON.stringify(drift, null, 2);
}
