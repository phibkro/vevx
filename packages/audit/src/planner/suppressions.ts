import { readFileSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import YAML from 'yaml';
import type { CorroboratedFinding } from './findings';

// ── Glob matching ──

/**
 * Simple glob match supporting * and ** patterns.
 * Covers common suppression patterns like "test/**" or "src/*.ts".
 */
function simpleGlobMatch(filePath: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const regexStr = pattern
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/<<<GLOBSTAR>>>/g, '.*')
    .replace(/\?/g, '[^/]');

  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(filePath);
}

// ── Types ──

export interface SuppressionRule {
  rule: string;
  file?: string;
  glob?: string;
  reason: string;
}

export interface InlineSuppression {
  file: string;
  line: number;
  ruleId: string;
  reason?: string;
}

export interface SuppressionConfig {
  suppressions: SuppressionRule[];
}

// ── Inline suppression parsing ──

const SUPPRESS_PATTERN = /\/\/\s*audit-suppress\s+([\w-]+)(?:\s+"([^"]*)")?/;

/**
 * Scan file contents for `// audit-suppress RULE-ID` comments.
 * A suppression applies to:
 * - The same line it's on
 * - The next line (when the comment is on its own line)
 */
export function parseInlineSuppressions(
  files: { relativePath: string; content: string }[],
): InlineSuppression[] {
  const suppressions: InlineSuppression[] = [];

  for (const file of files) {
    const lines = file.content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(SUPPRESS_PATTERN);
      if (!match) continue;

      const ruleId = match[1];
      const reason = match[2] || undefined;
      const lineNum = i + 1; // 1-indexed

      // Suppress this line
      suppressions.push({ file: file.relativePath, line: lineNum, ruleId, reason });

      // Also suppress next line (common pattern: comment above the code)
      if (i + 1 < lines.length) {
        suppressions.push({ file: file.relativePath, line: lineNum + 1, ruleId, reason });
      }
    }
  }

  return suppressions;
}

// ── Config file parsing ──

/**
 * Look for .audit-suppress.yaml in the target directory.
 * Returns parsed suppression rules, or empty array if not found.
 */
export function parseSuppressConfig(targetPath: string): SuppressionRule[] {
  const configPath = join(resolve(targetPath), '.audit-suppress.yaml');
  if (!existsSync(configPath)) return [];

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = YAML.parse(raw);

  if (!parsed || !Array.isArray(parsed.suppressions)) return [];

  return parsed.suppressions
    .filter((s: unknown): s is Record<string, unknown> =>
      typeof s === 'object' && s !== null && 'rule' in s
    )
    .map((s: Record<string, unknown>) => ({
      rule: String(s.rule),
      file: typeof s.file === 'string' ? s.file : undefined,
      glob: typeof s.glob === 'string' ? s.glob : undefined,
      reason: typeof s.reason === 'string' ? s.reason : 'Suppressed by config',
    }));
}

// ── Suppression matching ──

/**
 * Check if a corroborated finding is suppressed by config rules or inline comments.
 * Returns the suppression reason if suppressed, undefined otherwise.
 */
export function findingSuppressedBy(
  finding: CorroboratedFinding,
  configRules: SuppressionRule[],
  inlineSuppressions: InlineSuppression[],
): string | undefined {
  const f = finding.finding;

  // Check config-based suppressions
  for (const rule of configRules) {
    if (rule.rule !== f.ruleId) continue;

    // If rule has file constraint, check it
    if (rule.file) {
      const matchesFile = f.locations.some(loc => loc.file === rule.file);
      if (!matchesFile) continue;
    }

    // If rule has glob constraint, check it
    if (rule.glob) {
      const matchesGlob = f.locations.some(loc => simpleGlobMatch(loc.file, rule.glob!));
      if (!matchesGlob) continue;
    }

    return rule.reason;
  }

  // Check inline suppressions
  for (const sup of inlineSuppressions) {
    if (sup.ruleId !== f.ruleId) continue;

    const matchesLocation = f.locations.some(
      loc => loc.file === sup.file && loc.startLine === sup.line
    );

    if (matchesLocation) {
      return sup.reason ?? `Inline suppression in ${sup.file}:${sup.line}`;
    }
  }

  return undefined;
}

/**
 * Apply suppressions to a list of corroborated findings.
 * Returns { active, suppressed } partition.
 */
export function applySuppressions(
  findings: CorroboratedFinding[],
  configRules: SuppressionRule[],
  inlineSuppressions: InlineSuppression[],
): { active: CorroboratedFinding[]; suppressed: { finding: CorroboratedFinding; reason: string }[] } {
  const active: CorroboratedFinding[] = [];
  const suppressed: { finding: CorroboratedFinding; reason: string }[] = [];

  for (const f of findings) {
    const reason = findingSuppressedBy(f, configRules, inlineSuppressions);
    if (reason) {
      suppressed.push({ finding: f, reason });
    } else {
      active.push(f);
    }
  }

  return { active, suppressed };
}
