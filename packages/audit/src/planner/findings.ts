// ── Severity ──

/**
 * Compliance-oriented severity scale.
 * Distinct from the existing agent Severity ("critical" | "warning" | "info")
 * which is too coarse for compliance reporting.
 */
export type AuditSeverity = 'critical' | 'high' | 'medium' | 'low' | 'informational';

const SEVERITY_RANK: Record<AuditSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  informational: 4,
};

export function compareSeverity(a: AuditSeverity, b: AuditSeverity): number {
  return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

// ── Location ──

/**
 * A precise code location. A finding may span multiple locations
 * (e.g. data flows from file A line 10 to file B line 45).
 */
export interface CodeLocation {
  file: string;       // relative path
  startLine: number;
  endLine?: number;   // omit for single-line findings
}

// ── Finding ──

/**
 * A single compliance finding produced by an audit agent.
 *
 * This is the atomic unit of audit output. Each finding ties a specific
 * code behavior to a specific compliance rule.
 */
export interface AuditFinding {
  /** Rule ID from the ruleset (e.g. "BAC-01", "CROSS-01") */
  ruleId: string;

  severity: AuditSeverity;

  /** Short title (<80 chars). What's wrong. */
  title: string;

  /** Why this is a compliance concern. References the specific rule requirement. */
  description: string;

  /** Where in the code. Multiple locations for cross-file issues (e.g. data flows). */
  locations: CodeLocation[];

  /** The actual code pattern observed. Verbatim snippet or description of behavior. */
  evidence: string;

  /** How to fix it. Concrete code suggestion or approach. */
  remediation: string;

  /** Agent's self-assessed confidence (0.0–1.0). */
  confidence: number;
}

// ── Task Result ──

/**
 * Output from a single audit task execution.
 * One task = one (component, rule category) pair or one cross-cutting analysis.
 */
export interface AuditTaskResult {
  taskId: string;
  type: 'component-scan' | 'cross-cutting' | 'synthesis';
  component?: string;
  rulesChecked: string[];
  findings: AuditFinding[];
  durationMs: number;

  /** Model used for this task */
  model: string;

  /** Tokens consumed (prompt + completion) */
  tokensUsed: number;
}

// ── Coverage ──

/**
 * Tracks which (component, rule) pairs were actually checked.
 * Gaps are as important as findings — an unchecked component is not "compliant,"
 * it's "unknown."
 */
export interface CoverageEntry {
  component: string;
  ruleId: string;
  checked: boolean;
  /** Why not checked, if applicable (e.g. "no relevant files", "budget exceeded", "agent failed") */
  reason?: string;
}

// ── Corroboration ──

/**
 * When multiple tasks flag the same issue (same rule + overlapping location),
 * they corroborate each other. Higher corroboration = higher confidence.
 */
export interface CorroboratedFinding {
  /** Canonical finding (best evidence/remediation chosen from sources) */
  finding: AuditFinding;

  /** How many independent tasks flagged this */
  corroborations: number;

  /** Task IDs that produced overlapping findings */
  sourceTaskIds: string[];

  /** Effective confidence: min(1.0, base_confidence + 0.1 * (corroborations - 1)) */
  effectiveConfidence: number;

  /** Whether this finding was suppressed by config or inline comment */
  suppressed?: boolean;

  /** Reason for suppression, if suppressed */
  suppressionReason?: string;
}

// ── Report ──

/**
 * The complete audit report. Output of the synthesis phase.
 */
export interface ComplianceReport {
  /** What was audited */
  scope: {
    ruleset: string;
    rulesetVersion: string;
    components: string[];
    totalFiles: number;
    /** Present when running incremental audit via --diff */
    diff?: { ref: string; changedFiles: number };
  };

  /** Deduplicated, corroborated findings ranked by severity */
  findings: CorroboratedFinding[];

  /** Finding counts by severity */
  summary: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    informational: number;
    total: number;
  };

  /** What was checked and what wasn't */
  coverage: {
    entries: CoverageEntry[];
    /** Components checked / total components */
    componentCoverage: number;
    /** Rules checked / total rules */
    ruleCoverage: number;
  };

  /** Execution metadata */
  metadata: {
    startedAt: string;  // ISO 8601
    completedAt: string;
    totalDurationMs: number;
    tasksExecuted: number;
    tasksFailed: number;
    totalTokensUsed: number;
    models: string[];
    /** Number of findings suppressed by config or inline comments */
    suppressedCount?: number;
  };
}

// ── Deduplication ──

/**
 * Two findings are considered duplicates if they reference the same rule
 * and have overlapping file locations.
 */
export function findingsOverlap(a: AuditFinding, b: AuditFinding): boolean {
  if (a.ruleId !== b.ruleId) return false;

  return a.locations.some(locA =>
    b.locations.some(locB => {
      if (locA.file !== locB.file) return false;
      // Same file, check line overlap
      const aEnd = locA.endLine ?? locA.startLine;
      const bEnd = locB.endLine ?? locB.startLine;
      return locA.startLine <= bEnd && locB.startLine <= aEnd;
    })
  );
}

/**
 * Merge duplicate findings across task results into corroborated findings.
 * Picks the highest-severity, highest-confidence version as canonical.
 */
export function deduplicateFindings(taskResults: AuditTaskResult[]): CorroboratedFinding[] {
  const groups: {
    findings: AuditFinding[];
    taskIds: string[];
  }[] = [];

  for (const result of taskResults) {
    for (const finding of result.findings) {
      // Try to merge into an existing group
      const match = groups.find(g =>
        g.findings.some(existing => findingsOverlap(existing, finding))
      );

      if (match) {
        match.findings.push(finding);
        if (!match.taskIds.includes(result.taskId)) {
          match.taskIds.push(result.taskId);
        }
      } else {
        groups.push({
          findings: [finding],
          taskIds: [result.taskId],
        });
      }
    }
  }

  return groups
    .map(group => {
      // Pick canonical: highest severity, then highest confidence
      const sorted = [...group.findings].sort((a, b) => {
        const sevDiff = compareSeverity(a.severity, b.severity);
        if (sevDiff !== 0) return sevDiff;
        return b.confidence - a.confidence;
      });

      const canonical = sorted[0];
      const corroborations = group.taskIds.length;
      const effectiveConfidence = Math.min(
        1.0,
        canonical.confidence + 0.1 * (corroborations - 1)
      );

      return {
        finding: canonical,
        corroborations,
        sourceTaskIds: group.taskIds,
        effectiveConfidence,
      };
    })
    .sort((a, b) => {
      // Sort by severity, then by effective confidence (desc)
      const sevDiff = compareSeverity(a.finding.severity, b.finding.severity);
      if (sevDiff !== 0) return sevDiff;
      return b.effectiveConfidence - a.effectiveConfidence;
    });
}

/**
 * Build the summary counts from corroborated findings.
 */
export function summarizeFindings(findings: CorroboratedFinding[]): ComplianceReport['summary'] {
  const summary = { critical: 0, high: 0, medium: 0, low: 0, informational: 0, total: 0 };
  for (const { finding } of findings) {
    summary[finding.severity]++;
    summary.total++;
  }
  return summary;
}
