/**
 * Parsed ruleset metadata from YAML frontmatter
 */
export interface RulesetMeta {
  framework: string;
  version: string;
  rulesetVersion: string;
  scope: string;
  languages: string[];
}

/**
 * A single compliance rule parsed from a ruleset
 */
export interface Rule {
  id: string; // e.g. "BAC-01", "CRYPTO-04"
  title: string;
  category: string; // e.g. "A01:2021 — Broken Access Control"
  severity: string; // "Critical", "High", "Medium", etc.
  appliesTo: string[]; // e.g. ["API routes", "HTTP handlers"]
  compliant: string;
  violation: string;
  whatToLookFor: string[];
  guidance: string;
}

/**
 * A cross-cutting concern parsed from a ruleset
 */
export interface CrossCuttingPattern {
  id: string; // e.g. "CROSS-01"
  title: string;
  scope: string;
  relatesTo: string[]; // rule IDs this pattern references
  objective: string;
  checks: string[]; // what to verify
}

/**
 * Parsed ruleset: metadata + rules + cross-cutting patterns
 */
export interface Ruleset {
  meta: RulesetMeta;
  rules: Rule[];
  crossCutting: CrossCuttingPattern[];
}

/**
 * A component (group of related files) to be audited
 */
export interface AuditComponent {
  name: string;
  path: string;
  files: string[]; // relative paths
  languages: string[];
  estimatedTokens: number;
}

/**
 * A task in the audit plan
 */
export interface AuditTask {
  id: string;
  wave: 1 | 2 | 3;
  type: "component-scan" | "cross-cutting" | "synthesis";
  component?: string; // component name (wave 1)
  rules: string[]; // rule IDs to check
  files: string[]; // file paths to include as context
  estimatedTokens: number;
  priority: number; // lower = higher priority (risk-based ordering)
  description: string; // human-readable task description
}

/**
 * The full audit plan
 */
export interface AuditPlan {
  ruleset: RulesetMeta;
  components: AuditComponent[];
  waves: {
    wave1: AuditTask[]; // component scans (parallel)
    wave2: AuditTask[]; // cross-cutting analysis (parallel, uses wave 1 outputs)
    wave3: AuditTask[]; // synthesis (single task)
  };
  stats: {
    totalTasks: number;
    totalRules: number;
    totalFiles: number;
    estimatedTokens: number;
  };
}

export type { ModelCaller, ModelCallerResult } from "@vevx/varp/lib";
