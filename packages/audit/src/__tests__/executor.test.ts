import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileContent } from '../agents/types';
import type { Ruleset, AuditPlan } from '../planner/types';
import type { AuditProgressEvent } from '../planner/executor';
import { executeAuditPlan } from '../planner/executor';

// Mock the client module
const { mockCallClaude } = vi.hoisted(() => ({
  mockCallClaude: vi.fn(),
}));
vi.mock('../client', () => ({
  callClaude: mockCallClaude,
}));

// ── Test data ──

const FILES: FileContent[] = [
  { path: '/p/src/api/routes.ts', relativePath: 'src/api/routes.ts', language: 'typescript', content: 'app.get("/users", handler)' },
  { path: '/p/src/api/auth.ts', relativePath: 'src/api/auth.ts', language: 'typescript', content: 'function login(req, res) {}' },
  { path: '/p/src/db/query.ts', relativePath: 'src/db/query.ts', language: 'typescript', content: 'db.query("SELECT * FROM users")' },
];

const RULESET: Ruleset = {
  meta: {
    framework: 'Test Framework',
    version: '1.0',
    rulesetVersion: '0.1.0',
    scope: 'test',
    languages: ['typescript'],
  },
  rules: [
    {
      id: 'SEC-01',
      title: 'SQL Injection',
      category: 'Security',
      severity: 'Critical',
      appliesTo: ['database queries'],
      compliant: 'Use parameterized queries',
      violation: 'String concatenation in queries',
      whatToLookFor: ['String interpolation in SQL'],
      guidance: 'Check for template literals in query strings',
    },
    {
      id: 'AUTH-01',
      title: 'Missing Auth',
      category: 'Authentication',
      severity: 'High',
      appliesTo: ['API routes'],
      compliant: 'All routes require auth middleware',
      violation: 'Routes without auth checks',
      whatToLookFor: ['Routes missing auth middleware'],
      guidance: 'Public routes should be explicitly marked',
    },
  ],
  crossCutting: [
    {
      id: 'CROSS-01',
      title: 'Auth Chain',
      scope: 'Full auth flow',
      relatesTo: ['AUTH-01'],
      objective: 'Verify auth chain from request to data access',
      checks: ['Auth middleware applied consistently'],
    },
  ],
};

function makePlan(): AuditPlan {
  return {
    ruleset: RULESET.meta,
    components: [
      { name: 'src/api', path: 'src/api', files: ['src/api/routes.ts', 'src/api/auth.ts'], languages: ['typescript'], estimatedTokens: 100 },
      { name: 'src/db', path: 'src/db', files: ['src/db/query.ts'], languages: ['typescript'], estimatedTokens: 50 },
    ],
    waves: {
      wave1: [
        {
          id: 'scan-1',
          wave: 1,
          type: 'component-scan',
          component: 'src/api',
          rules: ['AUTH-01'],
          files: ['src/api/routes.ts', 'src/api/auth.ts'],
          estimatedTokens: 100,
          priority: 1,
          description: 'Scan src/api against Authentication',
        },
        {
          id: 'scan-2',
          wave: 1,
          type: 'component-scan',
          component: 'src/db',
          rules: ['SEC-01'],
          files: ['src/db/query.ts'],
          estimatedTokens: 50,
          priority: 0,
          description: 'Scan src/db against Security',
        },
      ],
      wave2: [
        {
          id: 'cross-3',
          wave: 2,
          type: 'cross-cutting',
          rules: ['CROSS-01', 'AUTH-01'],
          files: ['src/api/routes.ts', 'src/api/auth.ts', 'src/db/query.ts'],
          estimatedTokens: 150,
          priority: 0,
          description: 'Auth Chain analysis',
        },
      ],
      wave3: [
        {
          id: 'synth-4',
          wave: 3,
          type: 'synthesis',
          rules: [],
          files: [],
          estimatedTokens: 0,
          priority: 0,
          description: 'Synthesis',
        },
      ],
    },
    stats: { totalTasks: 4, totalRules: 3, totalFiles: 3, estimatedTokens: 300 },
  };
}

// ── Helpers ──

function validResponse(findings: object[] = []) {
  return JSON.stringify({ findings });
}

const FINDING_SQL_INJECTION = {
  ruleId: 'SEC-01',
  severity: 'critical',
  title: 'SQL injection in query.ts',
  description: 'String concatenation used in SQL query',
  locations: [{ file: 'src/db/query.ts', startLine: 1 }],
  evidence: 'db.query("SELECT * FROM users")',
  remediation: 'Use parameterized queries',
  confidence: 0.9,
};

const FINDING_MISSING_AUTH = {
  ruleId: 'AUTH-01',
  severity: 'high',
  title: 'Missing auth middleware on /users route',
  description: 'GET /users has no authentication',
  locations: [{ file: 'src/api/routes.ts', startLine: 1 }],
  evidence: 'app.get("/users", handler)',
  remediation: 'Add auth middleware',
  confidence: 0.85,
};

// ── Tests ──

beforeEach(() => {
  mockCallClaude.mockReset();
});

describe('executeAuditPlan', () => {
  it('executes all waves and returns a ComplianceReport', async () => {
    mockCallClaude
      .mockResolvedValueOnce(validResponse([FINDING_MISSING_AUTH]))  // scan-1
      .mockResolvedValueOnce(validResponse([FINDING_SQL_INJECTION])) // scan-2
      .mockResolvedValueOnce(validResponse([]));                     // cross-3

    const report = await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
    });

    expect(report.scope.ruleset).toBe('Test Framework');
    expect(report.scope.totalFiles).toBe(3);
    expect(report.findings).toHaveLength(2);
    expect(report.summary.total).toBe(2);
    expect(report.summary.critical).toBe(1);
    expect(report.summary.high).toBe(1);
    expect(report.metadata.tasksExecuted).toBe(3);
    expect(report.metadata.tasksFailed).toBe(0);
  });

  it('calls Claude once per non-synthesis task', async () => {
    mockCallClaude.mockResolvedValue(validResponse([]));

    await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
    });

    // 2 wave1 tasks + 1 wave2 task = 3 API calls
    expect(mockCallClaude).toHaveBeenCalledTimes(3);
  });

  it('deduplicates overlapping findings across waves', async () => {
    const duplicateFinding = {
      ...FINDING_MISSING_AUTH,
      ruleId: 'AUTH-01',
      confidence: 0.7,
    };

    mockCallClaude
      .mockResolvedValueOnce(validResponse([FINDING_MISSING_AUTH]))
      .mockResolvedValueOnce(validResponse([]))
      .mockResolvedValueOnce(validResponse([duplicateFinding])); // cross-cutting also finds it

    const report = await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
    });

    // Should deduplicate to 1 finding with boosted confidence
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].corroborations).toBe(2);
    expect(report.findings[0].effectiveConfidence).toBeGreaterThan(
      FINDING_MISSING_AUTH.confidence
    );
  });

  it('handles task failures gracefully', async () => {
    mockCallClaude
      .mockResolvedValueOnce(validResponse([FINDING_MISSING_AUTH])) // scan-1 ok
      .mockRejectedValueOnce(new Error('Rate limit exceeded'))      // scan-2 fails
      .mockResolvedValueOnce(validResponse([]));                    // cross-3 ok

    const report = await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
    });

    expect(report.metadata.tasksFailed).toBe(1);
    expect(report.metadata.tasksExecuted).toBe(2); // 2 succeeded
    expect(report.findings).toHaveLength(1);

    // Coverage should reflect the failure
    const failedCoverage = report.coverage.entries.find(
      e => e.ruleId === 'SEC-01' && !e.checked
    );
    expect(failedCoverage).toBeDefined();
    expect(failedCoverage?.reason).toBe('agent failed');
  });

  it('emits progress events in order', async () => {
    mockCallClaude.mockResolvedValue(validResponse([]));

    const events: AuditProgressEvent['type'][] = [];
    await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
      onProgress: (event) => events.push(event.type),
    });

    expect(events[0]).toBe('plan-ready');
    expect(events[1]).toBe('wave-start');
    expect(events).toContain('task-start');
    expect(events).toContain('task-complete');
    expect(events).toContain('wave-complete');
    expect(events[events.length - 1]).toBe('complete');
  });

  it('respects concurrency limit', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    mockCallClaude.mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise(r => setTimeout(r, 10));
      concurrent--;
      return validResponse([]);
    });

    await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
      concurrency: 1,
    });

    expect(maxConcurrent).toBe(1);
  });

  it('computes coverage correctly', async () => {
    mockCallClaude.mockResolvedValue(validResponse([]));

    const report = await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
    });

    // All tasks succeeded, so all should be checked
    const allChecked = report.coverage.entries.every(e => e.checked);
    expect(allChecked).toBe(true);
    expect(report.coverage.componentCoverage).toBeGreaterThan(0);
    expect(report.coverage.ruleCoverage).toBeGreaterThan(0);
  });

  it('handles empty plan', async () => {
    const emptyPlan: AuditPlan = {
      ...makePlan(),
      waves: { wave1: [], wave2: [], wave3: [] },
      stats: { totalTasks: 0, totalRules: 0, totalFiles: 0, estimatedTokens: 0 },
    };

    const report = await executeAuditPlan(emptyPlan, [], RULESET, {
      model: 'claude-sonnet-4-5-20250929',
    });

    expect(report.findings).toHaveLength(0);
    expect(report.metadata.tasksExecuted).toBe(0);
    expect(mockCallClaude).not.toHaveBeenCalled();
  });

  it('records token usage and models in metadata', async () => {
    mockCallClaude.mockResolvedValue(validResponse([]));

    const report = await executeAuditPlan(makePlan(), FILES, RULESET, {
      model: 'claude-sonnet-4-5-20250929',
    });

    expect(report.metadata.totalTokensUsed).toBeGreaterThan(0);
    expect(report.metadata.models).toContain('claude-sonnet-4-5-20250929');
  });
});
