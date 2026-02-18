import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import type { ComplianceReport } from '../planner/findings';
import {
  printComplianceReport,
  generateComplianceMarkdown,
  generateComplianceJson,
} from '../planner/compliance-reporter';

function makeReport(overrides: Partial<ComplianceReport> = {}): ComplianceReport {
  return {
    scope: {
      ruleset: 'OWASP Top 10',
      rulesetVersion: '0.1.0',
      components: ['src/api', 'src/db'],
      totalFiles: 5,
    },
    findings: [
      {
        finding: {
          ruleId: 'SEC-01',
          severity: 'critical',
          title: 'SQL injection in query builder',
          description: 'String concatenation used in SQL query',
          locations: [{ file: 'src/db/query.ts', startLine: 42, endLine: 45 }],
          evidence: 'db.query(`SELECT * FROM ${table}`)',
          remediation: 'Use parameterized queries',
          confidence: 0.9,
        },
        corroborations: 2,
        sourceTaskIds: ['scan-1', 'cross-3'],
        effectiveConfidence: 0.95,
      },
      {
        finding: {
          ruleId: 'AUTH-01',
          severity: 'high',
          title: 'Missing auth middleware on /users',
          description: 'GET /users has no authentication',
          locations: [{ file: 'src/api/routes.ts', startLine: 10 }],
          evidence: 'app.get("/users", handler)',
          remediation: 'Add auth middleware',
          confidence: 0.85,
        },
        corroborations: 1,
        sourceTaskIds: ['scan-2'],
        effectiveConfidence: 0.85,
      },
    ],
    summary: {
      critical: 1,
      high: 1,
      medium: 0,
      low: 0,
      informational: 0,
      total: 2,
    },
    coverage: {
      entries: [
        { component: 'src/api', ruleId: 'AUTH-01', checked: true },
        { component: 'src/db', ruleId: 'SEC-01', checked: true },
        { component: 'src/db', ruleId: 'CRYPTO-01', checked: false, reason: 'agent failed' },
      ],
      componentCoverage: 1.0,
      ruleCoverage: 0.67,
    },
    metadata: {
      startedAt: '2025-01-01T00:00:00.000Z',
      completedAt: '2025-01-01T00:01:00.000Z',
      totalDurationMs: 60000,
      tasksExecuted: 3,
      tasksFailed: 1,
      totalTokensUsed: 15000,
      models: ['claude-sonnet-4-5-20250929'],
    },
    ...overrides,
  };
}

describe('printComplianceReport', () => {
  let output: string[];

  beforeEach(() => {
    output = [];
    spyOn(console, 'log').mockImplementation((...args: any[]) => {
      output.push(args.join(' '));
    });
  });

  it('prints summary with finding counts', () => {
    printComplianceReport(makeReport());
    const text = output.join('\n');
    expect(text).toContain('2 findings');
    expect(text).toContain('critical');
    expect(text).toContain('high');
  });

  it('prints finding details', () => {
    printComplianceReport(makeReport());
    const text = output.join('\n');
    expect(text).toContain('SQL injection in query builder');
    expect(text).toContain('SEC-01');
    expect(text).toContain('src/db/query.ts:42-45');
    expect(text).toContain('Use parameterized queries');
  });

  it('prints corroboration count', () => {
    printComplianceReport(makeReport());
    const text = output.join('\n');
    expect(text).toContain('x2');
  });

  it('prints coverage gaps', () => {
    printComplianceReport(makeReport());
    const text = output.join('\n');
    expect(text).toContain('CRYPTO-01');
    expect(text).toContain('agent failed');
  });

  it('prints no violations message when clean', () => {
    printComplianceReport(makeReport({
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, informational: 0, total: 0 },
    }));
    const text = output.join('\n');
    expect(text).toContain('No compliance violations found');
  });

  it('prints metadata', () => {
    printComplianceReport(makeReport());
    const text = output.join('\n');
    expect(text).toContain('3 tasks');
    expect(text).toContain('15,000 tokens');
  });
});

describe('generateComplianceMarkdown', () => {
  it('generates valid markdown with headers', () => {
    const md = generateComplianceMarkdown(makeReport());
    expect(md).toContain('# Compliance Audit Report');
    expect(md).toContain('## Summary');
    expect(md).toContain('## Findings');
    expect(md).toContain('## Coverage');
    expect(md).toContain('## Metadata');
  });

  it('includes severity table', () => {
    const md = generateComplianceMarkdown(makeReport());
    expect(md).toContain('| Critical | 1 |');
    expect(md).toContain('| High | 1 |');
    expect(md).toContain('| **Total** | **2** |');
  });

  it('includes finding details with rule IDs', () => {
    const md = generateComplianceMarkdown(makeReport());
    expect(md).toContain('### CRITICAL: SQL injection in query builder');
    expect(md).toContain('**Rule:** SEC-01');
    expect(md).toContain('`src/db/query.ts:42-45`');
  });

  it('includes corroboration info', () => {
    const md = generateComplianceMarkdown(makeReport());
    expect(md).toContain('corroborated x2');
  });

  it('includes coverage gaps table', () => {
    const md = generateComplianceMarkdown(makeReport());
    expect(md).toContain('### Gaps');
    expect(md).toContain('| src/db | CRYPTO-01 | agent failed |');
  });

  it('omits zero-count severities from table', () => {
    const md = generateComplianceMarkdown(makeReport());
    expect(md).not.toContain('| Medium |');
    expect(md).not.toContain('| Low |');
  });

  it('handles empty findings', () => {
    const md = generateComplianceMarkdown(makeReport({
      findings: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0, informational: 0, total: 0 },
    }));
    expect(md).toContain('No compliance violations found');
  });
});

describe('generateComplianceJson', () => {
  it('returns valid JSON', () => {
    const json = generateComplianceJson(makeReport());
    const parsed = JSON.parse(json);
    expect(parsed.scope.ruleset).toBe('OWASP Top 10');
    expect(parsed.findings).toHaveLength(2);
    expect(parsed.summary.total).toBe(2);
  });

  it('preserves all report fields', () => {
    const report = makeReport();
    const parsed = JSON.parse(generateComplianceJson(report));
    expect(parsed.coverage.entries).toHaveLength(3);
    expect(parsed.metadata.models).toEqual(['claude-sonnet-4-5-20250929']);
  });
});
