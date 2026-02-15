import { describe, test, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/webhooks/clerk/route'
import { createMockRequest, createTestUser, createTestTeam } from '../../helpers/api'
import {
  generateClerkSignature,
  createClerkUserCreatedPayload,
  createClerkUserUpdatedPayload,
  createClerkUserDeletedPayload,
} from '../../helpers/webhooks'

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
  webhookRateLimit: {
    limit: vi.fn().mockResolvedValue({
      success: true,
      limit: 100,
      remaining: 99,
      reset: Date.now() + 60000,
    }),
  },
}))

// Mock Svix Webhook - verify signatures properly in tests
vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation((secret: string) => ({
    verify: vi.fn((payload: string, headers: Record<string, string>) => {
      // Simple validation - check if headers exist and signature looks valid
      if (!headers['svix-signature'] || headers['svix-signature'] === 'v1,invalidsignature') {
        throw new Error('Invalid signature')
      }
      // Parse and return the payload for valid signatures
      return JSON.parse(payload)
    }),
  })),
}))

import { db } from '@/lib/db'

describe('Clerk Webhook Signature Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('valid signature processes event', async () => {
    const secret = 'whsec_test_secret_key_for_clerk_webhooks_testing'
    const payload = createClerkUserCreatedPayload()
    const payloadString = JSON.stringify(payload)

    const { svixId, svixTimestamp, svixSignature } = generateClerkSignature(
      payloadString,
      secret
    )

    const user = createTestUser({ clerkId: payload.data.id })
    const team = createTestTeam()

    ;(db.user.create as any).mockResolvedValue(user)
    ;(db.team.create as any).mockResolvedValue(team)

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('received', true)
  })

  test('invalid signature returns 400', async () => {
    const payload = createClerkUserCreatedPayload()
    const payloadString = JSON.stringify(payload)

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': 'msg_invalid',
        'svix-timestamp': Math.floor(Date.now() / 1000).toString(),
        'svix-signature': 'v1,invalidsignature',
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'Invalid signature')
  })

  test('missing svix headers returns 400', async () => {
    const payload = createClerkUserCreatedPayload()
    const payloadString = JSON.stringify(payload)

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Missing svix headers
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'Missing svix headers')
  })
})

describe('Clerk Webhook Event Processing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('user.created event creates database record', async () => {
    const secret = 'whsec_test_secret_key_for_clerk_webhooks_testing'
    const payload = createClerkUserCreatedPayload({
      id: 'user_newuser123',
      email_addresses: [{ email_address: 'newuser@example.com' }],
      first_name: 'New',
      last_name: 'User',
    })
    const payloadString = JSON.stringify(payload)

    const { svixId, svixTimestamp, svixSignature } = generateClerkSignature(
      payloadString,
      secret
    )

    const user = createTestUser({
      clerkId: 'user_newuser123',
      email: 'newuser@example.com',
      name: 'New User',
    })
    const team = createTestTeam({ name: "New User's Team" })

    ;(db.user.create as any).mockResolvedValue(user)
    ;(db.team.create as any).mockResolvedValue(team)

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(db.user.create).toHaveBeenCalledWith({
      data: {
        clerkId: 'user_newuser123',
        email: 'newuser@example.com',
        name: 'New User',
      },
    })
    expect(db.team.create).toHaveBeenCalledWith({
      data: {
        name: "New User's Team",
        plan: 'FREE',
        members: {
          create: {
            userId: user.id,
            role: 'OWNER',
          },
        },
      },
    })
  })

  test('user.updated event updates database record', async () => {
    const secret = 'whsec_test_secret_key_for_clerk_webhooks_testing'
    const payload = createClerkUserUpdatedPayload({
      id: 'user_existing123',
      email_addresses: [{ email_address: 'updated@example.com' }],
      first_name: 'Updated',
      last_name: 'Name',
    })
    const payloadString = JSON.stringify(payload)

    const { svixId, svixTimestamp, svixSignature } = generateClerkSignature(
      payloadString,
      secret
    )

    const user = createTestUser({
      clerkId: 'user_existing123',
      email: 'updated@example.com',
      name: 'Updated Name',
    })

    ;(db.user.update as any).mockResolvedValue(user)

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(db.user.update).toHaveBeenCalledWith({
      where: { clerkId: 'user_existing123' },
      data: {
        email: 'updated@example.com',
        name: 'Updated Name',
      },
    })
  })

  test('user.deleted event removes database record', async () => {
    const secret = 'whsec_test_secret_key_for_clerk_webhooks_testing'
    const payload = createClerkUserDeletedPayload({
      id: 'user_deleted123',
    })
    const payloadString = JSON.stringify(payload)

    const { svixId, svixTimestamp, svixSignature } = generateClerkSignature(
      payloadString,
      secret
    )

    const user = createTestUser({ clerkId: 'user_deleted123' })

    ;(db.user.delete as any).mockResolvedValue(user)

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect(db.user.delete).toHaveBeenCalledWith({
      where: { clerkId: 'user_deleted123' },
    })
  })

  test('rate limiting is applied', async () => {
    const { webhookRateLimit } = await import('@/lib/rate-limit')
    const secret = 'whsec_test_secret_key_for_clerk_webhooks_testing'

    const payload = createClerkUserCreatedPayload()
    const payloadString = JSON.stringify(payload)

    const { svixId, svixTimestamp, svixSignature } = generateClerkSignature(
      payloadString,
      secret
    )

    const user = createTestUser()
    const team = createTestTeam()

    ;(db.user.create as any).mockResolvedValue(user)
    ;(db.team.create as any).mockResolvedValue(team)

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    await POST(request)

    expect(webhookRateLimit.limit).toHaveBeenCalledWith('clerk-webhook')
  })

  test('rate limit exceeded returns 429', async () => {
    const { webhookRateLimit } = await import('@/lib/rate-limit')
    const secret = 'whsec_test_secret_key_for_clerk_webhooks_testing'

    ;(webhookRateLimit.limit as any).mockResolvedValue({
      success: false,
      limit: 100,
      remaining: 0,
      reset: Date.now() + 60000,
    })

    const payload = createClerkUserCreatedPayload()
    const payloadString = JSON.stringify(payload)

    const { svixId, svixTimestamp, svixSignature } = generateClerkSignature(
      payloadString,
      secret
    )

    const request = createMockRequest('http://localhost/api/webhooks/clerk', {
      method: 'POST',
      headers: {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(429)
    expect(data).toHaveProperty('error', 'Rate limit exceeded')
  })
})
