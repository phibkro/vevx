import { describe, test, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/webhooks/stripe/route'
import { createMockRequest, createMockDb, createTestTeam } from '../../helpers/api'
import {
  generateStripeSignature,
  createStripeCheckoutCompletedPayload,
  createStripeSubscriptionCreatedPayload,
  createStripeSubscriptionDeletedPayload,
} from '../../helpers/webhooks'

// Mock dependencies
vi.mock('@/lib/db', () => ({
  db: createMockDb(),
}))

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

vi.mock('@/lib/stripe/config', () => {
  const mockConstructEvent = vi.fn()
  return {
    stripe: {
      webhooks: {
        constructEvent: mockConstructEvent,
      },
    },
    // Mock default implementation
    __mockConstructEvent: mockConstructEvent,
  }
})

vi.mock('@/lib/stripe/helpers', () => ({
  mapStripePlanToPrisma: vi.fn((productId: string) => {
    if (productId === 'prod_pro') return 'PRO'
    if (productId === 'prod_team') return 'TEAM'
    if (productId === 'prod_enterprise') return 'ENTERPRISE'
    return 'FREE'
  }),
}))

const { db } = await import('@/lib/db')
const { stripe } = await import('@/lib/stripe/config')

describe('Stripe Webhook Signature Verification', () => {
  const secret = 'whsec_test_secret_key_for_stripe_webhooks_testing'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('valid signature processes event', async () => {
    const payload = createStripeCheckoutCompletedPayload()
    const payloadString = JSON.stringify(payload)

    const signature = generateStripeSignature(payloadString, secret)

    // Mock successful signature verification
    ;(stripe.webhooks.constructEvent as any).mockReturnValue(payload as any)

    const team = createTestTeam()
    vi.mocked;(db.team.update as any).mockResolvedValue(team)

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': signature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data).toHaveProperty('received', true)
    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(
      payloadString,
      signature,
      secret
    )
  })

  test('invalid signature returns 400', async () => {
    const payload = createStripeCheckoutCompletedPayload()
    const payloadString = JSON.stringify(payload)

    // Mock signature verification failure
    ;(stripe.webhooks.constructEvent as any).mockImplementation(() => {
      throw new Error('Signature verification failed')
    })

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': 'invalid-signature',
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'Bad request')
    // Verify generic error message (not "Invalid signature")
    expect(data.error).not.toContain('signature')
    expect(data.error).not.toContain('verification')
  })

  test('missing signature header returns 400', async () => {
    const payload = createStripeCheckoutCompletedPayload()
    const payloadString = JSON.stringify(payload)

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Missing stripe-signature header
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    expect(data).toHaveProperty('error', 'Missing signature')
  })

  test('generic error message returned (no info leakage)', async () => {
    const payload = createStripeCheckoutCompletedPayload()
    const payloadString = JSON.stringify(payload)

    // Mock different types of errors
    ;(stripe.webhooks.constructEvent as any).mockImplementation(() => {
      throw new Error('Detailed internal error with sensitive information')
    })

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': 'invalid-sig',
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)
    const data = await response.json()

    expect(response.status).toBe(400)
    // Should be generic, not leak internal error details
    expect(data.error).toBe('Bad request')
    expect(data.error).not.toContain('internal')
    expect(data.error).not.toContain('sensitive')
  })
})

describe('Stripe Webhook Event Processing', () => {
  const secret = 'whsec_test_secret_key_for_stripe_webhooks_testing'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('checkout.session.completed creates subscription', async () => {
    const payload = createStripeCheckoutCompletedPayload({
      customer: 'cus_test_new',
      subscription: 'sub_test_new',
      metadata: { teamId: 'team-123' },
    })
    const payloadString = JSON.stringify(payload)

    ;(stripe.webhooks.constructEvent as any).mockReturnValue(payload as any)

    const team = createTestTeam({ id: 'team-123' })
    vi.mocked;(db.team.update as any).mockResolvedValue(team)

    const signature = generateStripeSignature(payloadString, secret)

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': signature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect;(db.team.update).toHaveBeenCalledWith({
      where: { id: 'team-123' },
      data: {
        stripeCustomerId: 'cus_test_new',
        stripeSubscriptionId: 'sub_test_new',
      },
    })
  })

  test('subscription.created updates team plan', async () => {
    const payload = createStripeSubscriptionCreatedPayload({
      customer: 'cus_existing',
      items: {
        data: [
          {
            price: {
              id: 'price_pro_monthly',
              product: 'prod_pro',
            },
          },
        ],
      },
    })
    const payloadString = JSON.stringify(payload)

    ;(stripe.webhooks.constructEvent as any).mockReturnValue(payload as any)

    const team = createTestTeam({ stripeCustomerId: 'cus_existing' })
    vi.mocked;(db.team.findUnique as any).mockResolvedValue(team)
    vi.mocked;(db.team.update as any).mockResolvedValue(team)

    const signature = generateStripeSignature(payloadString, secret)

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': signature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect;(db.team.findUnique).toHaveBeenCalledWith({
      where: { stripeCustomerId: 'cus_existing' },
    })
    expect;(db.team.update).toHaveBeenCalledWith({
      where: { id: team.id },
      data: {
        plan: 'PRO',
        stripeSubscriptionId: payload.data.object.id,
        stripeProductId: 'prod_pro',
        stripePriceId: 'price_pro_monthly',
      },
    })
  })

  test('subscription.deleted downgrades to free plan', async () => {
    const payload = createStripeSubscriptionDeletedPayload({
      customer: 'cus_cancelled',
    })
    const payloadString = JSON.stringify(payload)

    ;(stripe.webhooks.constructEvent as any).mockReturnValue(payload as any)

    const team = createTestTeam({
      stripeCustomerId: 'cus_cancelled',
      plan: 'PRO',
    })
    vi.mocked;(db.team.findUnique as any).mockResolvedValue(team)
    vi.mocked;(db.team.update as any).mockResolvedValue({ ...team, plan: 'FREE' })

    const signature = generateStripeSignature(payloadString, secret)

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': signature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    const response = await POST(request)

    expect(response.status).toBe(200)
    expect;(db.team.update).toHaveBeenCalledWith({
      where: { id: team.id },
      data: {
        plan: 'FREE',
        stripeSubscriptionId: null,
        stripeProductId: null,
        stripePriceId: null,
      },
    })
  })

  test('rate limiting is applied', async () => {
    const { webhookRateLimit } = await import('@/lib/rate-limit')

    const payload = createStripeCheckoutCompletedPayload()
    const payloadString = JSON.stringify(payload)

    ;(stripe.webhooks.constructEvent as any).mockReturnValue(payload as any)

    const team = createTestTeam()
    vi.mocked;(db.team.update as any).mockResolvedValue(team)

    const signature = generateStripeSignature(payloadString, secret)

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': signature,
        'Content-Type': 'application/json',
      },
      body: payloadString,
    })

    await POST(request)

    expect(webhookRateLimit.limit).toHaveBeenCalledWith('stripe-webhook')
  })

  test('rate limit exceeded returns 429', async () => {
    const { webhookRateLimit } = await import('@/lib/rate-limit')

    ;(webhookRateLimit.limit as any).mockResolvedValue({
      success: false,
      limit: 100,
      remaining: 0,
      reset: Date.now() + 60000,
    })

    const payload = createStripeCheckoutCompletedPayload()
    const payloadString = JSON.stringify(payload)

    const signature = generateStripeSignature(payloadString, secret)

    const request = createMockRequest('http://localhost/api/webhooks/stripe', {
      method: 'POST',
      headers: {
        'stripe-signature': signature,
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
