import { test, expect } from './helpers/setup'
import { createTestUser } from './helpers/clerk'
import { STRIPE_TEST_CARDS } from './helpers/stripe'

test.describe('Stripe Upgrade Flow', () => {
  test.skip('user can upgrade to Pro plan', async ({ page, cleanDb }) => {
    // TODO: Requires Clerk auth + Stripe Checkout UI testing
    // Full flow would be:
    // 1. Create authenticated user
    // 2. Visit /team or /pricing
    // 3. Click "Upgrade to Pro"
    // 4. Fill Stripe Checkout with test card
    // 5. Complete payment
    // 6. Verify webhook updates plan
    // 7. Verify dashboard shows Pro badge
  })

  test.skip('webhook updates team plan on successful payment', async ({ cleanDb }) => {
    // TODO: Requires Stripe webhook signature
    // This would test:
    // 1. Simulate Stripe checkout.session.completed webhook
    // 2. Verify team plan updated to PRO
    // 3. Verify Stripe customer ID saved
    // 4. Verify subscription ID saved
  })

  test.skip('failed payment does not change plan', async ({ cleanDb }) => {
    // TODO: Requires Stripe webhook signature
    // This would test:
    // 1. Create team on FREE plan
    // 2. Simulate failed payment webhook
    // 3. Verify plan is still FREE
  })

  test('team starts on FREE plan', async ({ cleanDb }) => {
    // Verify default plan assignment
    const { team } = await createTestUser()

    expect(team.plan).toBe('FREE')
  })
})
