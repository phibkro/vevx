import { afterEach, vi } from 'vitest'

// Set environment variables BEFORE any imports happen
// This must be at the top level, not in beforeAll()
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret_key_for_clerk_webhooks_testing'
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_stripe_key_for_testing'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_key_for_stripe_webhooks_testing'
process.env.STRIPE_PRO_PRICE_ID = 'price_test_pro'
process.env.STRIPE_TEAM_PRICE_ID = 'price_test_team'
process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY = 'pk_test_fake_key'
process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test_token_123'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'pk_test_fake_key'
process.env.CLERK_SECRET_KEY = 'sk_test_fake_key'

// Clean up mocks after each test
afterEach(() => {
  vi.restoreAllMocks()
})
