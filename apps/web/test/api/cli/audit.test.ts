import { describe, test, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/cli/audit/route'
import { createMockRequest, createTestApiKey, createTestTeam } from '../../helpers/api'
import bcrypt from 'bcryptjs'

// Mock dependencies
vi.mock('@/lib/db', async () => {
  return {
    db: {
      user: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      team: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      apiKey: {
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
      },
      audit: {
        create: vi.fn(),
        count: vi.fn(),
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      finding: {
        create: vi.fn(),
        findMany: vi.fn(),
      },
      teamMember: {
        create: vi.fn(),
      },
    },
  }
})

vi.mock('@/lib/rate-limit', () => ({
  auditRateLimit: {
    limit: vi.fn().mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 9,
      reset: Date.now() + 60000,
    }),
  },
}))

vi.mock('@/lib/stripe/config', () => ({
  PLAN_LIMITS: {
    FREE: {
      auditsPerMonth: 5,
      teamMembers: 1,
    },
    PRO: {
      auditsPerMonth: -1, // unlimited
      teamMembers: 1,
    },
    TEAM: {
      auditsPerMonth: -1,
      teamMembers: 5,
    },
    ENTERPRISE: {
      auditsPerMonth: -1,
      teamMembers: -1,
    },
  },
}))

import { db } from '@/lib/db'
import { auditRateLimit } from '@/lib/rate-limit'

describe('API Key Authentication', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('valid API key authenticates successfully', async () => {
    // Setup
    const plainKey = 'test-key-12345678'
    const keyHash = await bcrypt.hash(plainKey, 10)

    const team = createTestTeam()
    const apiKey = createTestApiKey({ keyHash, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])
    ;(db.audit.count as any).mockResolvedValue(0)
    ;(db.audit.create as any).mockResolvedValue({
      id: 'audit-123',
      teamId: team.id,
      repo: 'test/repo',
      commit: null,
      branch: null,
      prNumber: null,
      overallScore: 8.5,
      criticalCount: 0,
      warningCount: 2,
      infoCount: 3,
      durationMs: 1000,
      createdAt: new Date(),
    })
    ;(db.apiKey.update as any).mockResolvedValue(apiKey)

    // Test
    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    // Verify
    expect(response.status).toBe(200)
    expect(data).toHaveProperty('auditId')
    expect(data).toHaveProperty('teamId', team.id)
    expect(data).toHaveProperty('dashboardUrl')

    // Verify bcrypt.compare was used (implicitly - the hash matched)
    expect;(db.apiKey.findMany).toHaveBeenCalled()
    expect;(db.apiKey.update).toHaveBeenCalledWith({
      where: { id: apiKey.id },
      data: { lastUsed: expect.any(Date) },
    })
  })

  test('invalid API key returns 401', async () => {
    // Setup - no matching keys
    ;(db.apiKey.findMany as any).mockResolvedValue([])

    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid-key-12345',
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toHaveProperty('error', 'Invalid API key')
  })

  test('missing Authorization header returns 401', async () => {
    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toHaveProperty('error', 'Missing or invalid Authorization header')
  })

  test('malformed Authorization header returns 401', async () => {
    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': 'InvalidFormat key-12345',
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toHaveProperty('error', 'Missing or invalid Authorization header')
  })

  test('successful auth updates lastUsed timestamp', async () => {
    const plainKey = 'test-key-87654321'
    const keyHash = await bcrypt.hash(plainKey, 10)

    const team = createTestTeam()
    const apiKey = createTestApiKey({ keyHash, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])
    ;(db.audit.count as any).mockResolvedValue(0)
    ;(db.audit.create as any).mockResolvedValue({
      id: 'audit-123',
      teamId: team.id,
      repo: 'test/repo',
      commit: null,
      branch: null,
      prNumber: null,
      overallScore: 8.5,
      criticalCount: 0,
      warningCount: 2,
      infoCount: 3,
      durationMs: 1000,
      createdAt: new Date(),
    })
    ;(db.apiKey.update as any).mockResolvedValue(apiKey)

    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    await POST(request)

    expect;(db.apiKey.update).toHaveBeenCalledWith({
      where: { id: apiKey.id },
      data: { lastUsed: expect.any(Date) },
    })
  })

  test('bcrypt.compare is used (not bcrypt.hash)', async () => {
    // This test verifies the authentication logic uses bcrypt.compare
    // by checking that different keys with different hashes don't match

    const plainKey1 = 'correct-key-123'
    const plainKey2 = 'wrong-key-456'

    const keyHash1 = await bcrypt.hash(plainKey1, 10)
    const keyHash2 = await bcrypt.hash(plainKey2, 10)

    const team = createTestTeam()
    const apiKey = createTestApiKey({ keyHash: keyHash1, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])

    // Try with wrong key - should fail
    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey2}`,
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(401)
    expect(data).toHaveProperty('error', 'Invalid API key')
  })
})

describe('Rate Limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('request succeeds when under rate limit', async () => {
    const plainKey = 'test-key-ratelimit'
    const keyHash = await bcrypt.hash(plainKey, 10)

    const team = createTestTeam()
    const apiKey = createTestApiKey({ keyHash, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])
    ;(db.audit.count as any).mockResolvedValue(0)
    ;(db.audit.create as any).mockResolvedValue({
      id: 'audit-123',
      teamId: team.id,
      repo: 'test/repo',
      commit: null,
      branch: null,
      prNumber: null,
      overallScore: 8.5,
      criticalCount: 0,
      warningCount: 2,
      infoCount: 3,
      durationMs: 1000,
      createdAt: new Date(),
    })
    ;(db.apiKey.update as any).mockResolvedValue(apiKey)

    ;(auditRateLimit.limit as any).mockResolvedValue({
      success: true,
      limit: 10,
      remaining: 5,
      reset: Date.now() + 60000,
    })

    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(auditRateLimit.limit).toHaveBeenCalledWith(apiKey.id)
  })

  test('returns 429 when rate limit exceeded', async () => {
    const plainKey = 'test-key-exceeded'
    const keyHash = await bcrypt.hash(plainKey, 10)

    const team = createTestTeam()
    const apiKey = createTestApiKey({ keyHash, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])

    const resetTime = Date.now() + 60000
    ;(auditRateLimit.limit as any).mockResolvedValue({
      success: false,
      limit: 10,
      remaining: 0,
      reset: resetTime,
    })

    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data).toHaveProperty('error', 'Rate limit exceeded')
    expect(data).toHaveProperty('limit', 10)
    expect(data).toHaveProperty('remaining', 0)
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
  })
})

describe('Audit Creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('creates audit with findings successfully', async () => {
    const plainKey = 'test-key-audit'
    const keyHash = await bcrypt.hash(plainKey, 10)

    const team = createTestTeam()
    const apiKey = createTestApiKey({ keyHash, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])
    ;(db.audit.count as any).mockResolvedValue(0)
    ;(db.audit.create as any).mockResolvedValue({
      id: 'audit-with-findings',
      teamId: team.id,
      repo: 'test/repo',
      commit: 'abc123',
      branch: 'main',
      prNumber: null,
      overallScore: 7.5,
      criticalCount: 1,
      warningCount: 3,
      infoCount: 5,
      durationMs: 2000,
      createdAt: new Date(),
    })
    ;(db.apiKey.update as any).mockResolvedValue(apiKey)

    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        commit: 'abc123',
        branch: 'main',
        overallScore: 7.5,
        criticalCount: 1,
        warningCount: 3,
        infoCount: 5,
        durationMs: 2000,
        findings: [
          {
            agent: 'security',
            severity: 'CRITICAL',
            title: 'SQL Injection',
            description: 'Potential SQL injection vulnerability',
            file: 'src/db.ts',
            line: 42,
            suggestion: 'Use parameterized queries',
          },
        ],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.auditId).toBe('audit-with-findings')
    expect;(db.audit.create).toHaveBeenCalledWith({
      data: {
        teamId: team.id,
        repo: 'test/repo',
        commit: 'abc123',
        branch: 'main',
        prNumber: undefined,
        overallScore: 7.5,
        criticalCount: 1,
        warningCount: 3,
        infoCount: 5,
        durationMs: 2000,
        findings: {
          create: [
            {
              agent: 'security',
              severity: 'CRITICAL',
              title: 'SQL Injection',
              description: 'Potential SQL injection vulnerability',
              file: 'src/db.ts',
              line: 42,
              suggestion: 'Use parameterized queries',
            },
          ],
        },
      },
    })
  })

  test('enforces plan limits for free tier', async () => {
    const plainKey = 'test-key-limit'
    const keyHash = await bcrypt.hash(plainKey, 10)

    const team = createTestTeam({ plan: 'FREE' })
    const apiKey = createTestApiKey({ keyHash, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])
    ;(db.audit.count as any).mockResolvedValue(5) // At limit

    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        durationMs: 1000,
        findings: [],
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data).toHaveProperty('error', 'Monthly audit limit reached')
    expect(data).toHaveProperty('limit')
    expect(data).toHaveProperty('upgradeUrl')
  })

  test('invalid request body returns 400', async () => {
    const plainKey = 'test-key-invalid'
    const keyHash = await bcrypt.hash(plainKey, 10)

    const team = createTestTeam()
    const apiKey = createTestApiKey({ keyHash, team })

    ;(db.apiKey.findMany as any).mockResolvedValue([apiKey])

    const request = createMockRequest('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json',
      },
      body: {
        // Missing required fields
        repo: 'test/repo',
      },
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'Invalid request body')
  })
})
