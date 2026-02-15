import { test, expect } from './helpers/setup'
import { createTestUser, createTestApiKey } from './helpers/clerk'

test.describe('Rate Limiting', () => {
  test('enforces 10 requests per minute limit', async ({ cleanDb }) => {
    // Use PRO plan to avoid monthly audit limit
    const { user, team } = await createTestUser(undefined, 'PRO')
    const apiKey = await createTestApiKey(team.id, user.id)

    const auditData = {
      repo: 'test/rate-limit',
      overallScore: 8.5,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      durationMs: 1000,
      findings: [],
    }

    // Make 10 requests (should all succeed)
    for (let i = 0; i < 10; i++) {
      const response = await fetch('http://localhost:3000/api/cli/audit', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(auditData),
      })

      expect(response.status).toBe(200)
    }

    // 11th request should be rate limited
    const response = await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditData),
    })

    expect(response.status).toBe(429)

    // Check rate limit headers
    expect(response.headers.get('X-RateLimit-Limit')).toBe('10')
    expect(response.headers.get('X-RateLimit-Remaining')).toBe('0')
    expect(response.headers.has('X-RateLimit-Reset')).toBe(true)
  })

  test('different API keys have separate rate limits', async ({ cleanDb }) => {
    // Create two teams with API keys (use PRO plan to avoid monthly limits)
    const { user: user1, team: team1 } = await createTestUser(undefined, 'PRO')
    const { user: user2, team: team2 } = await createTestUser(undefined, 'PRO')

    const apiKey1 = await createTestApiKey(team1.id, user1.id)
    const apiKey2 = await createTestApiKey(team2.id, user2.id)

    const auditData = {
      repo: 'test/rate-limit',
      overallScore: 8.5,
      criticalCount: 0,
      warningCount: 0,
      infoCount: 0,
      durationMs: 1000,
      findings: [],
    }

    // Exhaust rate limit for key 1
    for (let i = 0; i < 10; i++) {
      await fetch('http://localhost:3000/api/cli/audit', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey1}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(auditData),
      })
    }

    // Key 1 should be rate limited
    const response1 = await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey1}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditData),
    })
    expect(response1.status).toBe(429)

    // Key 2 should still work
    const response2 = await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey2}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(auditData),
    })
    expect(response2.status).toBe(200)
  })
})
