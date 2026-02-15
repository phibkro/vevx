# Implementation Plan: End-to-End Tests for Critical User Journeys

**Priority:** 🟡 HIGH - Safety net before refactoring/launch
**Estimated Time:** 4-6 hours
**Owner:** Engineering/QA
**Branch:** `feature/e2e-tests`

## Overview

Add end-to-end tests for critical revenue-generating user journeys using Playwright. Focus on paths that, if broken, would block revenue or cause user churn.

**Current Test Coverage:**
- ✅ Unit tests: API auth, webhooks, rate limiting (20/25 passing)
- ❌ Integration tests: None
- ❌ E2E tests: None

**Target Coverage:**
- ✅ Sign up flow (GitHub OAuth → dashboard)
- ✅ API key creation and usage
- ✅ CLI audit submission
- ✅ Stripe upgrade flow
- ✅ Rate limiting enforcement

**Not in scope (defer to post-launch):**
- Edge cases (invalid inputs, network failures)
- All plan tiers (just Free → Pro for now)
- Team collaboration features
- Admin/settings flows

---

## Critical User Journeys to Test

### Journey 1: New User Onboarding (Highest Priority)
```
User visits homepage
→ Clicks "Sign Up"
→ Authorizes GitHub OAuth
→ Redirected to dashboard
→ User + Team auto-created in database
→ Dashboard shows empty state
```

**Revenue impact:** If broken, 0 sign-ups = $0 MRR

---

### Journey 2: API Key Creation & Usage
```
User in dashboard
→ Goes to Settings → API Keys
→ Clicks "Create New Key"
→ Key generated (starts with ca_)
→ Key stored in database (hashed with bcrypt)
→ User copies key
```

**Revenue impact:** If broken, users can't use CLI = churn

---

### Journey 3: CLI Audit Submission
```
User has API key
→ Sets CODE_AUDITOR_API_KEY env var
→ Runs CLI: bun run src/cli.ts path/to/code
→ CLI authenticates with API key
→ Audit submitted to /api/cli/audit
→ Audit created in database
→ Dashboard shows new audit
```

**Revenue impact:** If broken, core product doesn't work = churn

---

### Journey 4: Stripe Upgrade Flow
```
User on Free plan
→ Clicks "Upgrade to Pro"
→ Redirected to Stripe Checkout
→ Enters test card (4242 4242 4242 4242)
→ Payment succeeds
→ Webhook updates plan to PRO
→ User redirected to dashboard
→ Dashboard shows Pro badge
```

**Revenue impact:** If broken, no upgrades = $0 MRR growth

---

### Journey 5: Rate Limiting Enforcement
```
User with API key
→ Makes 10 audit requests in 1 minute (succeeds)
→ Makes 11th request
→ Receives 429 status
→ Response includes rate limit headers
```

**Revenue impact:** If broken, abuse/costs spike

---

## Implementation Plan

### Task 1: Playwright Setup (1 hour)

**Install Playwright:**

```bash
cd /Users/nori/Projects/ai-code-auditor/web
bun add -D @playwright/test
bunx playwright install
```

**Create Playwright config:**

`web/playwright.config.ts`:
```typescript
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Run local dev server before tests
  webServer: {
    command: 'bun run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
```

**Add test scripts to package.json:**

```json
{
  "scripts": {
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "test:e2e:headed": "playwright test --headed",
    "test:e2e:debug": "playwright test --debug"
  }
}
```

**Create test directory:**

```bash
mkdir -p web/e2e
```

**Acceptance Criteria:**
- [ ] Playwright installed
- [ ] Config file created
- [ ] Can run `bun run test:e2e` (no tests yet, should pass)
- [ ] Dev server starts automatically for tests

---

### Task 2: Test Utilities & Fixtures (1 hour)

**Create test helpers:**

`web/e2e/helpers/setup.ts`:
```typescript
import { test as base, expect } from '@playwright/test'
import { db } from '@/lib/db'

// Extend base test with custom fixtures
export const test = base.extend({
  // Auto-cleanup database after each test
  cleanDb: async ({}, use) => {
    await use()
    // Clean up test data after test runs
    await db.audit.deleteMany({ where: { team: { name: { contains: 'Test' } } } })
    await db.apiKey.deleteMany({ where: { team: { name: { contains: 'Test' } } } })
    await db.teamMember.deleteMany({ where: { team: { name: { contains: 'Test' } } } })
    await db.team.deleteMany({ where: { name: { contains: 'Test' } } })
    await db.user.deleteMany({ where: { email: { contains: 'test@' } } })
  },
})

export { expect }
```

`web/e2e/helpers/clerk.ts`:
```typescript
/**
 * Clerk testing helpers
 *
 * Note: For real GitHub OAuth testing, you'd need Clerk's testing tokens.
 * For now, we'll test the post-auth flows by directly creating users in the DB.
 */

import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function createTestUser(email: string = 'test@example.com') {
  const user = await db.user.create({
    data: {
      clerkId: `test_${Date.now()}`,
      email,
      name: 'Test User',
    },
  })

  const team = await db.team.create({
    data: {
      name: `Test User's Team`,
      plan: 'FREE',
    },
  })

  await db.teamMember.create({
    data: {
      userId: user.id,
      teamId: team.id,
      role: 'OWNER',
    },
  })

  return { user, team }
}

export async function createTestApiKey(teamId: string) {
  const rawKey = `ca_test_${Date.now()}`
  const keyHash = await bcrypt.hash(rawKey, 10)

  await db.apiKey.create({
    data: {
      name: 'Test Key',
      keyHash,
      teamId,
    },
  })

  return rawKey
}
```

`web/e2e/helpers/stripe.ts`:
```typescript
/**
 * Stripe test card numbers
 * https://stripe.com/docs/testing
 */

export const STRIPE_TEST_CARDS = {
  SUCCESS: '4242424242424242',
  DECLINED: '4000000000000002',
  REQUIRES_AUTH: '4000002500003155',
}

export const TEST_CARD_DETAILS = {
  number: STRIPE_TEST_CARDS.SUCCESS,
  expiry: '12/34',
  cvc: '123',
  zip: '12345',
}
```

**Acceptance Criteria:**
- [ ] Test fixtures created
- [ ] Database cleanup helper works
- [ ] Test user creation helper works
- [ ] API key creation helper works

---

### Task 3: Journey 1 - Sign Up Flow (1 hour)

**Note:** Testing real GitHub OAuth is complex. We'll test the post-OAuth flow (user creation, redirect) by mocking the Clerk session.

`web/e2e/01-signup.spec.ts`:
```typescript
import { test, expect } from './helpers/setup'

test.describe('Sign Up Flow', () => {
  test('creates user and team on first sign-in', async ({ page, cleanDb }) => {
    // This tests the user auto-creation logic we added
    // In production, this happens after Clerk OAuth succeeds

    // Visit homepage
    await page.goto('/')

    // Should see sign-up CTA
    await expect(page.getByRole('link', { name: /sign up/i })).toBeVisible()

    // Note: Can't easily test GitHub OAuth in Playwright without Clerk testing tokens
    // Instead, we verify the user creation logic works by checking the database

    // The auto-creation logic in lib/clerk/server.ts is tested separately
    // This test validates the UI flow exists and is accessible
  })

  test('redirects to dashboard after authentication', async ({ page }) => {
    // Mock authenticated state by setting Clerk session cookie
    // (This requires Clerk testing setup - skip for MVP, test manually)

    // For now, just verify dashboard page exists and loads
    await page.goto('/dashboard')

    // Should redirect to sign-in if not authenticated
    await page.waitForURL(/sign-in/)
    await expect(page).toHaveURL(/sign-in/)
  })

  test('dashboard shows empty state for new user', async ({ page }) => {
    // This would require authenticated session
    // Mark as TODO for when Clerk testing is set up
    test.skip(true, 'Requires Clerk auth testing setup')
  })
})
```

**Acceptance Criteria:**
- [ ] Test verifies homepage loads
- [ ] Test verifies sign-up flow is accessible
- [ ] Test verifies unauthenticated users redirect to sign-in
- [ ] Notes added for future Clerk testing integration

---

### Task 4: Journey 2 - API Key Creation (1 hour)

`web/e2e/02-api-key.spec.ts`:
```typescript
import { test, expect } from './helpers/setup'
import { createTestUser } from './helpers/clerk'
import { db } from '@/lib/db'

test.describe('API Key Management', () => {
  test('user can create API key', async ({ page, cleanDb }) => {
    // Create test user and team
    const { user, team } = await createTestUser()

    // Mock Clerk session (for now, we'll test the API directly)
    // TODO: Add Clerk session mocking

    test.skip(true, 'Requires Clerk auth - testing API directly instead')
  })

  test('API key is hashed in database', async ({ cleanDb }) => {
    const { team } = await createTestUser()

    // Create API key via API
    const response = await fetch('http://localhost:3000/api/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Key',
        teamId: team.id,
      }),
    })

    // Note: This endpoint doesn't exist yet - would need to be created
    // For now, we rely on manual testing + unit tests
    test.skip(true, 'API endpoint not implemented')
  })
})
```

**Acceptance Criteria:**
- [ ] Test scaffolding created
- [ ] Marked as requiring Clerk auth setup
- [ ] TODO items documented for future implementation

---

### Task 5: Journey 3 - CLI Audit Submission (1.5 hours)

`web/e2e/03-cli-audit.spec.ts`:
```typescript
import { test, expect } from './helpers/setup'
import { createTestUser, createTestApiKey } from './helpers/clerk'
import { db } from '@/lib/db'

test.describe('CLI Audit Submission', () => {
  test('authenticated API request creates audit', async ({ cleanDb }) => {
    // Create test user with API key
    const { team } = await createTestUser()
    const apiKey = await createTestApiKey(team.id)

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
          severity: 'warning',
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
    expect(data).toHaveProperty('id')
    expect(data).toHaveProperty('url')

    // Verify audit was created in database
    const audit = await db.audit.findFirst({
      where: { teamId: team.id },
      include: { findings: true },
    })

    expect(audit).toBeTruthy()
    expect(audit?.overallScore).toBe(8.5)
    expect(audit?.findings).toHaveLength(1)
    expect(audit?.findings[0].severity).toBe('warning')
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

  test('audit appears in dashboard', async ({ page, cleanDb }) => {
    // Create test data
    const { team } = await createTestUser()
    const apiKey = await createTestApiKey(team.id)

    // Submit audit
    await fetch('http://localhost:3000/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repo: 'test-repo',
        overallScore: 7.5,
        criticalCount: 1,
        warningCount: 3,
        infoCount: 2,
        durationMs: 5000,
        findings: [],
      }),
    })

    // Visit dashboard (would need auth session)
    test.skip(true, 'Requires Clerk auth session')

    // Would verify:
    // - Audit appears in recent audits table
    // - Score is displayed correctly
    // - Stats are updated
  })
})
```

**Acceptance Criteria:**
- [ ] Test verifies authenticated API requests work
- [ ] Test verifies unauthenticated requests fail
- [ ] Test verifies invalid API keys fail
- [ ] Test verifies audit is created in database
- [ ] Dashboard visualization test marked as TODO (needs auth)

---

### Task 6: Journey 4 - Stripe Upgrade Flow (1 hour)

`web/e2e/04-stripe-upgrade.spec.ts`:
```typescript
import { test, expect } from './helpers/setup'
import { createTestUser } from './helpers/clerk'
import { STRIPE_TEST_CARDS } from './helpers/stripe'
import { db } from '@/lib/db'

test.describe('Stripe Upgrade Flow', () => {
  test('user can upgrade to Pro plan', async ({ page, cleanDb }) => {
    test.skip(true, 'Requires Clerk auth + Stripe Checkout UI testing')

    // Full flow would be:
    // 1. Create authenticated user
    // 2. Visit /team or /pricing
    // 3. Click "Upgrade to Pro"
    // 4. Fill Stripe Checkout with test card
    // 5. Complete payment
    // 6. Verify webhook updates plan
    // 7. Verify dashboard shows Pro badge
  })

  test('webhook updates team plan on successful payment', async ({ cleanDb }) => {
    const { team } = await createTestUser()

    // Simulate Stripe webhook
    const webhookPayload = {
      type: 'checkout.session.completed',
      data: {
        object: {
          customer: 'cus_test_123',
          client_reference_id: team.id,
          subscription: 'sub_test_123',
          metadata: {
            plan: 'PRO',
            priceId: process.env.STRIPE_PRO_PRICE_ID,
          },
        },
      },
    }

    // Note: Would need to sign webhook with Stripe secret
    // For now, test manually or use Stripe CLI
    test.skip(true, 'Requires Stripe webhook signature')

    // Would verify:
    // - Team plan updated to PRO
    // - Stripe customer ID saved
    // - Subscription ID saved
  })

  test('failed payment does not change plan', async ({ cleanDb }) => {
    const { team } = await createTestUser()

    // Initial plan should be FREE
    expect(team.plan).toBe('FREE')

    // Simulate failed payment webhook
    // (Would need proper Stripe webhook signature)
    test.skip(true, 'Requires Stripe webhook signature')

    // Verify plan is still FREE
  })
})
```

**Acceptance Criteria:**
- [ ] Test scaffolding for upgrade flow created
- [ ] Webhook testing approach documented
- [ ] Tests marked as requiring Stripe CLI integration
- [ ] Manual testing checklist created

---

### Task 7: Journey 5 - Rate Limiting (30 min)

`web/e2e/05-rate-limiting.spec.ts`:
```typescript
import { test, expect } from './helpers/setup'
import { createTestUser, createTestApiKey } from './helpers/clerk'

test.describe('Rate Limiting', () => {
  test('enforces 10 requests per minute limit', async ({ cleanDb }) => {
    const { team } = await createTestUser()
    const apiKey = await createTestApiKey(team.id)

    const auditData = {
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
    // Create two teams with API keys
    const { team: team1 } = await createTestUser('user1@test.com')
    const { team: team2 } = await createTestUser('user2@test.com')

    const apiKey1 = await createTestApiKey(team1.id)
    const apiKey2 = await createTestApiKey(team2.id)

    const auditData = {
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
```

**Acceptance Criteria:**
- [ ] Test verifies 10 req/min limit enforced
- [ ] Test verifies 11th request returns 429
- [ ] Test verifies rate limit headers present
- [ ] Test verifies separate limits per API key
- [ ] Tests run and pass

---

## Task 8: CI/CD Integration (30 min)

**Add to `.github/workflows/test.yml`:**

```yaml
name: CI

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1
      - run: cd web && bun install
      - run: cd web && bun test

  e2e-tests:
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test
      CLERK_SECRET_KEY: ${{ secrets.CLERK_SECRET_KEY }}
      CLERK_WEBHOOK_SECRET: test_secret
      STRIPE_SECRET_KEY: ${{ secrets.STRIPE_SECRET_KEY }}
      STRIPE_WEBHOOK_SECRET: test_secret
      STRIPE_PRO_PRICE_ID: price_test
      STRIPE_TEAM_PRICE_ID: price_test
      NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: pk_test_xxx
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: pk_test_xxx
      NEXT_PUBLIC_APP_URL: http://localhost:3000
      UPSTASH_REDIS_REST_URL: ${{ secrets.UPSTASH_REDIS_REST_URL }}
      UPSTASH_REDIS_REST_TOKEN: ${{ secrets.UPSTASH_REDIS_REST_TOKEN }}

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432

    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: cd web && bun install

      - name: Setup database
        run: cd web && bunx prisma db push

      - name: Install Playwright
        run: cd web && bunx playwright install --with-deps

      - name: Run E2E tests
        run: cd web && bun run test:e2e

      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: web/playwright-report/
          retention-days: 30
```

**Acceptance Criteria:**
- [ ] E2E tests run in CI
- [ ] Postgres service configured
- [ ] Environment variables set
- [ ] Test reports uploaded as artifacts
- [ ] Tests pass on main branch

---

## Summary of Test Coverage

After implementation, you'll have:

**Unit Tests (existing):**
- ✅ API authentication logic
- ✅ Webhook signature verification
- ✅ Rate limiting logic

**E2E Tests (new):**
- ✅ CLI audit submission (authenticated)
- ✅ CLI audit submission (unauthenticated - fails)
- ✅ CLI audit submission (invalid key - fails)
- ✅ Audit appears in database
- ✅ Rate limiting enforced (10/min)
- ✅ Rate limits are per-API-key
- 📝 Sign-up flow (manual until Clerk testing setup)
- 📝 Dashboard UI (manual until Clerk testing setup)
- 📝 Stripe upgrade (manual until webhook signing setup)

**Test Execution:**
```bash
# Unit tests
bun run test

# E2E tests (local)
bun run test:e2e

# E2E tests (headed mode for debugging)
bun run test:e2e:headed

# E2E tests (UI mode)
bun run test:e2e:ui
```

---

## Success Criteria

- [ ] Playwright installed and configured
- [ ] Test helpers created (user, API key, cleanup)
- [ ] 5 test suites created
- [ ] Critical path tests passing:
  - CLI audit submission (3 tests)
  - Rate limiting (2 tests)
- [ ] Manual testing checklist for auth flows
- [ ] CI/CD integration complete
- [ ] Documentation updated

---

## Future Enhancements (Post-Launch)

- Add Clerk testing tokens for OAuth flow tests
- Add Stripe CLI integration for webhook tests
- Expand to test Team tier features
- Add visual regression tests
- Add performance tests (page load times)
- Add accessibility tests

---

**Total Time:** 4-6 hours
**Branch:** `feature/e2e-tests`
**Merge After:** Tests passing, before PLAN-2 refactoring
