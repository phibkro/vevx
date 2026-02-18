import { join } from 'path';
import { mkdtempSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import {
  parseInlineSuppressions,
  parseSuppressConfig,
  findingSuppressedBy,
  applySuppressions,
} from '../planner/suppressions';
import type { CorroboratedFinding, AuditFinding } from '../planner/findings';

// ── Test helpers ──

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'audit-suppress-'));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return {
    ruleId: 'BAC-01',
    severity: 'high',
    title: 'Missing auth',
    description: 'No auth check',
    locations: [{ file: 'src/api/routes.ts', startLine: 10 }],
    evidence: 'app.get("/admin")',
    remediation: 'Add auth middleware',
    confidence: 0.85,
    ...overrides,
  };
}

function makeCorroborated(overrides: Partial<AuditFinding> = {}): CorroboratedFinding {
  return {
    finding: makeFinding(overrides),
    corroborations: 1,
    sourceTaskIds: ['scan-1'],
    effectiveConfidence: 0.85,
  };
}

// ── parseInlineSuppressions ──

describe('parseInlineSuppressions', () => {
  it('extracts suppression from inline comment', () => {
    const files = [{
      relativePath: 'src/api/routes.ts',
      content: 'app.get("/admin") // audit-suppress BAC-01',
    }];

    const suppressions = parseInlineSuppressions(files);

    expect(suppressions.length).toBeGreaterThan(0);
    expect(suppressions[0]).toEqual(expect.objectContaining({
      file: 'src/api/routes.ts',
      line: 1,
      ruleId: 'BAC-01',
    }));
  });

  it('extracts reason from quoted string', () => {
    const files = [{
      relativePath: 'src/api/routes.ts',
      content: '// audit-suppress BAC-01 "validated in middleware"\napp.get("/admin")',
    }];

    const suppressions = parseInlineSuppressions(files);

    const withReason = suppressions.find(s => s.reason);
    expect(withReason).toBeDefined();
    expect(withReason!.reason).toBe('validated in middleware');
  });

  it('suppresses the next line when comment is on its own line', () => {
    const files = [{
      relativePath: 'src/api/routes.ts',
      content: '// audit-suppress BAC-01\napp.get("/admin")',
    }];

    const suppressions = parseInlineSuppressions(files);

    // Should create suppressions for both line 1 and line 2
    const lines = suppressions.map(s => s.line);
    expect(lines).toContain(1);
    expect(lines).toContain(2);
  });

  it('handles files with no suppressions', () => {
    const files = [{
      relativePath: 'src/clean.ts',
      content: 'const x = 1;\nconst y = 2;',
    }];

    expect(parseInlineSuppressions(files)).toEqual([]);
  });
});

// ── parseSuppressConfig ──

describe('parseSuppressConfig', () => {
  it('parses .audit-suppress.yaml', () => {
    writeFileSync(join(tempDir, '.audit-suppress.yaml'), `
suppressions:
  - rule: BAC-01
    file: src/admin/routes.ts
    reason: "Authorization handled by gateway"
  - rule: LOG-01
    glob: "test/**"
    reason: "Test files don't need audit logging"
`, 'utf-8');

    const rules = parseSuppressConfig(tempDir);

    expect(rules).toHaveLength(2);
    expect(rules[0]).toEqual({
      rule: 'BAC-01',
      file: 'src/admin/routes.ts',
      glob: undefined,
      reason: 'Authorization handled by gateway',
    });
    expect(rules[1]).toEqual({
      rule: 'LOG-01',
      file: undefined,
      glob: 'test/**',
      reason: "Test files don't need audit logging",
    });
  });

  it('returns empty array when no config exists', () => {
    expect(parseSuppressConfig(tempDir)).toEqual([]);
  });

  it('returns empty array for malformed config', () => {
    writeFileSync(join(tempDir, '.audit-suppress.yaml'), 'not: valid', 'utf-8');
    expect(parseSuppressConfig(tempDir)).toEqual([]);
  });
});

// ── findingSuppressedBy ──

describe('findingSuppressedBy', () => {
  it('suppresses by config rule with file match', () => {
    const finding = makeCorroborated();
    const configRules = [{
      rule: 'BAC-01',
      file: 'src/api/routes.ts',
      reason: 'Handled by gateway',
    }];

    const reason = findingSuppressedBy(finding, configRules, []);
    expect(reason).toBe('Handled by gateway');
  });

  it('suppresses by config rule with glob match', () => {
    const finding = makeCorroborated({
      locations: [{ file: 'test/api/routes.test.ts', startLine: 5 }],
    });
    const configRules = [{
      rule: 'BAC-01',
      glob: 'test/**',
      reason: 'Test file',
    }];

    const reason = findingSuppressedBy(finding, configRules, []);
    expect(reason).toBe('Test file');
  });

  it('does not suppress when rule ID does not match', () => {
    const finding = makeCorroborated();
    const configRules = [{
      rule: 'OTHER-01',
      file: 'src/api/routes.ts',
      reason: 'Not this finding',
    }];

    expect(findingSuppressedBy(finding, configRules, [])).toBeUndefined();
  });

  it('suppresses by inline comment', () => {
    const finding = makeCorroborated();
    const inlines = [{
      file: 'src/api/routes.ts',
      line: 10,
      ruleId: 'BAC-01',
      reason: 'Inline reason',
    }];

    const reason = findingSuppressedBy(finding, [], inlines);
    expect(reason).toBe('Inline reason');
  });

  it('config rules take precedence over inline', () => {
    const finding = makeCorroborated();
    const configRules = [{
      rule: 'BAC-01',
      file: 'src/api/routes.ts',
      reason: 'Config reason',
    }];
    const inlines = [{
      file: 'src/api/routes.ts',
      line: 10,
      ruleId: 'BAC-01',
      reason: 'Inline reason',
    }];

    const reason = findingSuppressedBy(finding, configRules, inlines);
    expect(reason).toBe('Config reason');
  });
});

// ── applySuppressions ──

describe('applySuppressions', () => {
  it('partitions findings into active and suppressed', () => {
    const findings = [
      makeCorroborated(),
      makeCorroborated({
        ruleId: 'INJ-01',
        locations: [{ file: 'src/db/query.ts', startLine: 5 }],
      }),
    ];

    const configRules = [{
      rule: 'BAC-01',
      file: 'src/api/routes.ts',
      reason: 'Suppressed',
    }];

    const { active, suppressed } = applySuppressions(findings, configRules, []);

    expect(active).toHaveLength(1);
    expect(active[0].finding.ruleId).toBe('INJ-01');
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0].reason).toBe('Suppressed');
  });

  it('returns all findings as active when no suppressions match', () => {
    const findings = [makeCorroborated(), makeCorroborated({ ruleId: 'INJ-01' })];
    const { active, suppressed } = applySuppressions(findings, [], []);

    expect(active).toHaveLength(2);
    expect(suppressed).toHaveLength(0);
  });
});
