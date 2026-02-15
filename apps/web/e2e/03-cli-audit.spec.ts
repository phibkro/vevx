import { test, expect } from './helpers/setup'
import { createTestUser, createTestApiKey } from './helpers/clerk'
import { db } from '@/lib/db'

test.describe('CLI Audit Submission', () => {
  test('authenticated API request creates audit', async ({ cleanDb }) => {
    // Create test user with API key
    const { user, team } = await createTestUser()
    const apiKey = await createTestApiKey(team.id, user.id)

    // Submit audit via API (simulating CLI)
    const auditData = {
      repo: 'test-repo',
      commit: 'abc123',
      overallScore: 8.5,
      criticalCount: 0,
      warningCount: 2,
      infoCount: 5,
      durationMs: 5000,
      findings: [
        {
          agent: 'security',
          severity: 'WARNING',
          title: 'Potential SQL injection',
          description: 'Use parameterized queries',
          file: 'src/db.ts',
          line: 42,
        },
      ],
    }

    const response = await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditData),
    })

    expect(response.status).toBe(200)

    const data = await response.json()
    expect(data).toHaveProperty('auditId')
    expect(data).toHaveProperty('dashboardUrl')

    // Verify audit was created in database
    const audit = await db.audit.findFirst({
      where: { teamId: team.id },
      include: { findings: true },
    })

    expect(audit).toBeTruthy()
    expect(audit?.overallScore).toBe(8.5)
    expect(audit?.findings).toHaveLength(1)
    expect(audit?.findings[0].severity).toBe('WARNING')
  })

  test('unauthenticated request returns 401', async ({ cleanDb }) => {
    const response = await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        durationMs: 1000,
        findings: [],
      }),
    })

    expect(response.status).toBe(401)
  })

  test('invalid API key returns 401', async ({ cleanDb }) => {
    const response = await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ca_invalid_key',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        durationMs: 1000,
        findings: [],
      }),
    })

    expect(response.status).toBe(401)
  })

  test('audit data is saved correctly in database', async ({ cleanDb }) => {
    // Create test user with API key
    const { user, team } = await createTestUser()
    const apiKey = await createTestApiKey(team.id, user.id)

    // Submit audit with multiple findings
    const auditData = {
      repo: 'my-awesome-repo',
      commit: 'abc123def456',
      branch: 'main',
      prNumber: 42,
      overallScore: 7.2,
      criticalCount: 1,
      warningCount: 3,
      infoCount: 8,
      durationMs: 12500,
      findings: [
        {
          agent: 'security',
          severity: 'CRITICAL',
          title: 'SQL Injection vulnerability',
          description: 'Raw SQL query detected',
          file: 'src/db/queries.ts',
          line: 15,
          suggestion: 'Use parameterized queries',
        },
        {
          agent: 'best-practices',
          severity: 'WARNING',
          title: 'Missing error handling',
          description: 'Async function without try-catch',
          file: 'src/api/users.ts',
          line: 82,
        },
        {
          agent: 'performance',
          severity: 'INFO',
          title: 'Inefficient loop',
          description: 'Consider using map instead of forEach',
          file: 'src/utils/transform.ts',
          line: 23,
        },
      ],
    }

    const response = await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditData),
    })

    expect(response.status).toBe(200)

    // Verify all audit data is correctly saved
    const audit = await db.audit.findFirst({
      where: { teamId: team.id },
      include: { findings: true },
    })

    expect(audit).toBeTruthy()
    expect(audit?.repo).toBe('my-awesome-repo')
    expect(audit?.commit).toBe('abc123def456')
    expect(audit?.branch).toBe('main')
    expect(audit?.prNumber).toBe(42)
    expect(audit?.overallScore).toBe(7.2)
    expect(audit?.criticalCount).toBe(1)
    expect(audit?.warningCount).toBe(3)
    expect(audit?.infoCount).toBe(8)
    expect(audit?.durationMs).toBe(12500)

    // Verify findings are correctly saved
    expect(audit?.findings).toHaveLength(3)

    const criticalFinding = audit?.findings.find(f => f.severity === 'CRITICAL')
    expect(criticalFinding).toBeTruthy()
    expect(criticalFinding?.title).toBe('SQL Injection vulnerability')
    expect(criticalFinding?.line).toBe(15)
    expect(criticalFinding?.suggestion).toBe('Use parameterized queries')
  })
})
