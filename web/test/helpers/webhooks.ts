import crypto from 'crypto'

/**
 * Generate valid Clerk webhook signature (Svix format)
 */
export function generateClerkSignature(
  payload: string,
  secret: string,
  timestamp?: number
): {
  svixId: string
  svixTimestamp: string
  svixSignature: string
} {
  const ts = timestamp || Math.floor(Date.now() / 1000)
  const msgId = `msg_${crypto.randomBytes(12).toString('hex')}`

  // Svix signature format: timestamp.payload
  const signedContent = `${msgId}.${ts}.${payload}`

  // Create HMAC signature
  const signature = crypto
    .createHmac('sha256', secret.split('_').pop() || secret) // Remove "whsec_" prefix
    .update(signedContent)
    .digest('base64')

  return {
    svixId: msgId,
    svixTimestamp: ts.toString(),
    svixSignature: `v1,${signature}`,
  }
}

/**
 * Generate valid Stripe webhook signature
 */
export function generateStripeSignature(
  payload: string,
  secret: string,
  timestamp?: number
): string {
  const ts = timestamp || Math.floor(Date.now() / 1000)

  // Stripe signature format: timestamp.payload
  const signedContent = `${ts}.${payload}`

  // Create HMAC signature
  const signature = crypto
    .createHmac('sha256', secret)
    .update(signedContent)
    .digest('hex')

  return `t=${ts},v1=${signature}`
}

/**
 * Mock Clerk user.created webhook payload
 */
export function createClerkUserCreatedPayload(overrides = {}) {
  return {
    type: 'user.created',
    data: {
      id: 'user_test123',
      email_addresses: [
        {
          email_address: 'test@example.com',
          id: 'email_test123',
        },
      ],
      first_name: 'Test',
      last_name: 'User',
      created_at: Date.now(),
      ...overrides,
    },
  }
}

/**
 * Mock Clerk user.updated webhook payload
 */
export function createClerkUserUpdatedPayload(overrides = {}) {
  return {
    type: 'user.updated',
    data: {
      id: 'user_test123',
      email_addresses: [
        {
          email_address: 'updated@example.com',
          id: 'email_test123',
        },
      ],
      first_name: 'Updated',
      last_name: 'User',
      updated_at: Date.now(),
      ...overrides,
    },
  }
}

/**
 * Mock Clerk user.deleted webhook payload
 */
export function createClerkUserDeletedPayload(overrides = {}) {
  return {
    type: 'user.deleted',
    data: {
      id: 'user_test123',
      deleted: true,
      ...overrides,
    },
  }
}

/**
 * Mock Stripe checkout.session.completed webhook payload
 */
export function createStripeCheckoutCompletedPayload(overrides = {}) {
  return {
    id: 'evt_test123',
    object: 'event',
    type: 'checkout.session.completed',
    data: {
      object: {
        id: 'cs_test123',
        object: 'checkout.session',
        customer: 'cus_test123',
        subscription: 'sub_test123',
        metadata: {
          teamId: 'test-team-id',
        },
        ...overrides,
      },
    },
  }
}

/**
 * Mock Stripe subscription.created webhook payload
 */
export function createStripeSubscriptionCreatedPayload(overrides = {}) {
  return {
    id: 'evt_test123',
    object: 'event',
    type: 'customer.subscription.created',
    data: {
      object: {
        id: 'sub_test123',
        object: 'subscription',
        customer: 'cus_test123',
        items: {
          data: [
            {
              price: {
                id: 'price_test123',
                product: 'prod_pro',
              },
            },
          ],
        },
        ...overrides,
      },
    },
  }
}

/**
 * Mock Stripe subscription.deleted webhook payload
 */
export function createStripeSubscriptionDeletedPayload(overrides = {}) {
  return {
    id: 'evt_test123',
    object: 'event',
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: 'sub_test123',
        object: 'subscription',
        customer: 'cus_test123',
        ...overrides,
      },
    },
  }
}
