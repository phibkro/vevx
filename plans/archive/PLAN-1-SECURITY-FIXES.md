# Implementation Plan: Security Fixes (Critical Path)

**Priority:** 🔴 CRITICAL - Blocks launch
**Estimated Time:** 24-32 hours
**Owner:** Technical team
**Deadline:** Complete before any public launch

## Overview

Fix 5 critical security vulnerabilities that would cause immediate failure in production. These are not theoretical risks - the Technical Architect review shows ~60% probability of security breach within 24 hours of launch with current code.

---

## Critical Issues Summary

1. **Broken API Key Authentication** - Authentication completely non-functional
2. **Missing Webhook Verification** - Clerk webhooks accept unauthenticated requests
3. **No Rate Limiting** - Open to DOS attacks and abuse
4. **Exposed Secrets** - `.env` file with real API key committed to git
5. **Zero Test Coverage** - Cannot validate fixes work

---

## Wave 1: Emergency Fixes (Day 1 - 8 hours)

### Task 1.1: Rotate Exposed API Key (30 minutes) 🔥 IMMEDIATE

**File:** `/Users/nori/Projects/ai-code-auditor/.env`

**Problem:** Real Anthropic API key is committed to git repository and visible in history.

**Steps:**
1. Log in to Anthropic console
2. Revoke exposed API key immediately
3. Generate new API key
4. Update local `.env` file
5. Add `.env` to `.gitignore` if not already
6. Create `.env.example` template:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-your-key-here
   CODE_AUDITOR_API_KEY=your-dashboard-api-key-here
   ```
7. Git commit the .gitignore change
8. **DO NOT** commit the new API key

**Acceptance Criteria:**
- [ ] Old API key revoked in Anthropic console
- [ ] New API key set in `.env` locally
- [ ] `.env` in `.gitignore`
- [ ] `.env.example` committed (without real keys)
- [ ] Confirmed `.env` not in git with `git status`

---

### Task 1.2: Fix API Key Authentication (4 hours)

**File:** `web/app/api/cli/audit/route.ts`

**Current Code (BROKEN):**
```typescript
const apiKey = authHeader.substring(7) // Remove 'Bearer '
const keyHash = await bcrypt.hash(apiKey, 10) // ❌ WRONG!

const apiKeyRecord = await db.apiKey.findFirst({
  where: {
    // Note: This is simplified. In production, hash the key on creation
  },
})
```

**Problems:**
- `bcrypt.hash()` generates NEW hash each time (never matches stored hash)
- WHERE clause is empty (returns any random key)
- Must use `bcrypt.compare()` instead

**Solution:**
```typescript
// web/app/api/cli/audit/route.ts

const apiKey = authHeader.substring(7)

// Option 1: Scan and compare (works but slow for many keys)
const apiKeys = await db.apiKey.findMany()
let apiKeyRecord = null

for (const key of apiKeys) {
  const isValid = await bcrypt.compare(apiKey, key.keyHash)
  if (isValid) {
    apiKeyRecord = key
    break
  }
}

if (!apiKeyRecord) {
  return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
}

// Option 2: Indexed prefix lookup (better performance)
// Store first 8 chars of key as plaintext in keyPrefix column
// Then only compare against matching prefixes
```

**Better Architecture (Recommended):**
```typescript
// Add keyPrefix to Prisma schema
model ApiKey {
  id        String   @id @default(cuid())
  keyPrefix String   @db.VarChar(8)  // First 8 chars, plaintext
  keyHash   String   // Full hash

  @@index([keyPrefix])
}

// Then in route:
const keyPrefix = apiKey.substring(0, 8)
const candidates = await db.apiKey.findMany({
  where: { keyPrefix }
})

let apiKeyRecord = null
for (const candidate of candidates) {
  if (await bcrypt.compare(apiKey, candidate.keyHash)) {
    apiKeyRecord = candidate
    break
  }
}
```

**Steps:**
1. Update Prisma schema to add `keyPrefix` column
2. Run migration: `npx prisma migrate dev --name add_key_prefix`
3. Update API key creation to store prefix
4. Update authentication logic as shown above
5. Write unit test for authentication flow

**Acceptance Criteria:**
- [ ] Authentication uses `bcrypt.compare()` not `bcrypt.hash()`
- [ ] Valid API key returns 200 with audit data
- [ ] Invalid API key returns 401 with error message
- [ ] Test coverage for auth success and failure cases

---

### Task 1.3: Add Clerk Webhook Signature Verification (2 hours)

**File:** `web/app/api/webhooks/clerk/route.ts`

**Current Code (INSECURE):**
```typescript
export async function POST(request: NextRequest) {
  const payload = await request.json()
  const { type, data } = payload

  // ❌ No verification! Anyone can POST here
  switch (type) {
    case 'user.created': {
      // Creates user without checking request is from Clerk
```

**Solution:**
```typescript
import { Webhook } from 'svix'

export async function POST(request: NextRequest) {
  // Get raw body as text (required for signature verification)
  const payload = await request.text()

  // Get Svix headers
  const svixId = request.headers.get('svix-id')
  const svixTimestamp = request.headers.get('svix-timestamp')
  const svixSignature = request.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json(
      { error: 'Missing svix headers' },
      { status: 400 }
    )
  }

  // Verify webhook signature
  const webhook = new Webhook(process.env.CLERK_WEBHOOK_SECRET!)

  let event
  try {
    event = webhook.verify(payload, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    })
  } catch (err) {
    console.error('Webhook verification failed:', err)
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }

  // Now process verified event
  const { type, data } = event
  switch (type) {
    // ... existing logic
  }
}
```

**Steps:**
1. Install svix package: `cd web && bun add svix`
2. Add CLERK_WEBHOOK_SECRET to .env.example
3. Get webhook secret from Clerk dashboard
4. Update webhook handler with verification
5. Test with Clerk webhook testing tool

**Acceptance Criteria:**
- [ ] Valid Clerk webhooks succeed (verified signature)
- [ ] Invalid signatures return 400 error
- [ ] Missing headers return 400 error
- [ ] Test with Clerk's webhook testing tool

---

### Task 1.4: Fix Stripe Webhook Error Messages (30 minutes)

**File:** `web/app/api/webhooks/stripe/route.ts`

**Current Code (Timing Attack Risk):**
```typescript
try {
  event = stripe.webhooks.constructEvent(body, signature, secret!)
} catch (error) {
  console.error('Webhook signature verification failed:', error)
  return NextResponse.json(
    { error: 'Invalid signature' },  // ❌ Reveals reason
    { status: 400 }
  )
}
```

**Solution:**
```typescript
try {
  event = stripe.webhooks.constructEvent(body, signature, secret!)
} catch (error) {
  // Log details server-side only
  console.error('[STRIPE_WEBHOOK_ERROR]', {
    error: error.message,
    timestamp: new Date().toISOString()
  })

  // Return generic error to client
  return NextResponse.json(
    { error: 'Bad request' },  // ✅ Generic message
    { status: 400 }
  )
}
```

**Acceptance Criteria:**
- [ ] Error response is generic ("Bad request")
- [ ] Detailed error logged server-side only
- [ ] Valid webhooks still work

---

## Wave 2: Rate Limiting (Day 2 - 8 hours)

### Task 2.1: Choose Rate Limiting Solution (1 hour)

**Options:**

**Option A: Upstash Redis (Recommended)**
```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'),
})
```
- Pros: Serverless-friendly, works with Vercel
- Cons: Requires Upstash account ($10/mo)

**Option B: In-Memory (Dev/Simple)**
```typescript
// Simple Map-based rate limiter
const requestCounts = new Map<string, number>()
```
- Pros: No dependencies, free
- Cons: Doesn't work across serverless instances, resets on deploy

**Option C: Vercel Edge Config**
- Pros: Built-in to Vercel
- Cons: Less flexible, Vercel-specific

**Decision:** Use Upstash for production, in-memory for local dev

**Acceptance Criteria:**
- [ ] Rate limiting solution chosen and documented
- [ ] Account created (if Upstash)
- [ ] Credentials in .env.example

---

### Task 2.2: Implement Rate Limiting Middleware (4 hours)

**File:** `web/lib/rate-limit.ts`

```typescript
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'
import { NextResponse } from 'next/server'

// Configure different limits for different endpoints
export const apiRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(10, '10 s'), // 10 requests per 10 seconds
  prefix: 'ratelimit:api',
})

export const webhookRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '60 s'), // 100 webhooks per minute
  prefix: 'ratelimit:webhook',
})

export const auditRateLimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(5, '60 s'), // 5 audits per minute per user
  prefix: 'ratelimit:audit',
})

// Helper to apply rate limiting
export async function checkRateLimit(
  identifier: string,
  limiter: Ratelimit
): Promise<NextResponse | null> {
  const { success, limit, reset, remaining } = await limiter.limit(identifier)

  if (!success) {
    return NextResponse.json(
      {
        error: 'Rate limit exceeded',
        limit,
        remaining,
        reset: new Date(reset),
      },
      {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
        },
      }
    )
  }

  return null // No rate limit hit, proceed
}
```

**Apply to routes:**

```typescript
// web/app/api/cli/audit/route.ts
import { checkRateLimit, auditRateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  // ... existing auth ...

  // Rate limit by team ID
  const rateLimitError = await checkRateLimit(
    `team:${team.id}`,
    auditRateLimit
  )
  if (rateLimitError) return rateLimitError

  // ... continue with audit ...
}
```

**Acceptance Criteria:**
- [ ] Rate limiting applied to `/api/cli/audit`
- [ ] Rate limiting applied to `/api/keys/create`
- [ ] Rate limiting applied to `/api/webhooks/*`
- [ ] Returns 429 with helpful headers when exceeded
- [ ] Different limits for different endpoints
- [ ] Identifier based on team/user, not IP (IP is unreliable in serverless)

---

### Task 2.3: Add Rate Limit Tests (2 hours)

**File:** `web/__tests__/rate-limit.test.ts`

```typescript
import { describe, test, expect } from 'bun:test'
import { checkRateLimit, auditRateLimit } from '@/lib/rate-limit'

describe('Rate Limiting', () => {
  test('allows requests under limit', async () => {
    const result = await checkRateLimit('test-user-1', auditRateLimit)
    expect(result).toBeNull() // No error = under limit
  })

  test('blocks requests over limit', async () => {
    const identifier = 'test-user-2'

    // Make 6 requests (limit is 5 per minute)
    for (let i = 0; i < 6; i++) {
      const result = await checkRateLimit(identifier, auditRateLimit)

      if (i < 5) {
        expect(result).toBeNull() // First 5 should pass
      } else {
        expect(result?.status).toBe(429) // 6th should fail
      }
    }
  })

  test('resets after window', async () => {
    // This test requires mocking time or waiting
    // Skip in CI, useful for manual testing
  })
})
```

**Acceptance Criteria:**
- [ ] Test for under-limit requests (should succeed)
- [ ] Test for over-limit requests (should return 429)
- [ ] Test for rate limit headers
- [ ] All tests pass

---

## Wave 3: Test Coverage (Day 3-4 - 8-16 hours)

### Task 3.1: Set Up Test Infrastructure (2 hours)

**Files to create:**
- `web/vitest.config.ts` or use Bun's built-in test runner
- `web/__tests__/setup.ts` - Test database setup
- `web/__tests__/helpers.ts` - Test utilities

**Bun test setup:**
```typescript
// web/__tests__/setup.ts
import { beforeAll, afterAll } from 'bun:test'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL_TEST,
})

beforeAll(async () => {
  // Clean test database
  await prisma.$executeRaw`TRUNCATE TABLE "User", "Team", "Audit", "Finding", "ApiKey" CASCADE`
})

afterAll(async () => {
  await prisma.$disconnect()
})

export { prisma }
```

**Acceptance Criteria:**
- [ ] Test framework configured (Bun test or Vitest)
- [ ] Test database configured (separate from dev)
- [ ] Test helpers created
- [ ] `bun test` command works

---

### Task 3.2: API Key Authentication Tests (3 hours)

**File:** `web/__tests__/auth.test.ts`

```typescript
import { describe, test, expect, beforeEach } from 'bun:test'
import { POST } from '@/app/api/cli/audit/route'
import { prisma } from './setup'
import bcrypt from 'bcryptjs'

describe('API Key Authentication', () => {
  beforeEach(async () => {
    // Clean up
    await prisma.apiKey.deleteMany()
    await prisma.team.deleteMany()
    await prisma.user.deleteMany()
  })

  test('valid API key authenticates successfully', async () => {
    // Setup
    const team = await prisma.team.create({
      data: { name: 'Test Team', plan: 'PRO' }
    })

    const plainKey = 'test-key-12345678'
    const keyHash = await bcrypt.hash(plainKey, 10)
    const keyPrefix = plainKey.substring(0, 8)

    await prisma.apiKey.create({
      data: {
        teamId: team.id,
        userId: 'test-user',
        name: 'Test Key',
        keyHash,
        keyPrefix,
      }
    })

    // Test
    const request = new Request('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${plainKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        repo: 'test/repo',
        overallScore: 8.5,
        criticalCount: 0,
        warningCount: 2,
        infoCount: 3,
        agentResults: [],
      })
    })

    const response = await POST(request as any)
    expect(response.status).toBe(200)
  })

  test('invalid API key returns 401', async () => {
    const request = new Request('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer invalid-key-12345',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ /* ... */ })
    })

    const response = await POST(request as any)
    expect(response.status).toBe(401)
  })

  test('missing Authorization header returns 401', async () => {
    const request = new Request('http://localhost/api/cli/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ /* ... */ })
    })

    const response = await POST(request as any)
    expect(response.status).toBe(401)
  })
})
```

**Acceptance Criteria:**
- [ ] Test for valid API key (should return 200)
- [ ] Test for invalid API key (should return 401)
- [ ] Test for missing Authorization header (should return 401)
- [ ] Test for malformed Authorization header
- [ ] All tests pass

---

### Task 3.3: Webhook Verification Tests (2 hours)

**File:** `web/__tests__/webhooks.test.ts`

Test both Clerk and Stripe webhook verification with valid/invalid signatures.

**Acceptance Criteria:**
- [ ] Test valid Clerk webhook signature
- [ ] Test invalid Clerk webhook signature
- [ ] Test valid Stripe webhook signature
- [ ] Test invalid Stripe webhook signature
- [ ] All tests pass

---

### Task 3.4: Audit Creation Tests (2 hours)

**File:** `web/__tests__/audit.test.ts`

Test the full audit creation flow including database transactions.

**Acceptance Criteria:**
- [ ] Test successful audit creation
- [ ] Test audit with findings
- [ ] Test plan limit enforcement (free tier max 5/month)
- [ ] Test invalid data returns 400
- [ ] All tests pass

---

## Wave 4: Environment Validation (Day 4 - 2 hours)

### Task 4.1: Add Environment Variable Validation (2 hours)

**File:** `web/lib/env.ts`

```typescript
const requiredEnvVars = [
  'DATABASE_URL',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'CLERK_SECRET_KEY',
  'CLERK_WEBHOOK_SECRET',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'NEXT_PUBLIC_APP_URL',
] as const

const optionalEnvVars = [
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
] as const

function validateEnv() {
  const missing: string[] = []

  for (const key of requiredEnvVars) {
    if (!process.env[key]) {
      missing.push(key)
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n  - ${missing.join('\n  - ')}\n\n` +
      `Copy .env.example to .env and fill in the values.`
    )
  }

  console.log('✅ Environment variables validated')
}

// Run validation on module load (fail fast at startup)
validateEnv()

export {}
```

**Import in:** `web/app/layout.tsx` (at the top)

**Acceptance Criteria:**
- [ ] Missing env vars cause immediate startup failure
- [ ] Error message lists specific missing vars
- [ ] Error message is helpful (points to .env.example)
- [ ] Production deployment fails fast if misconfigured

---

## Summary & Validation

### Total Time Estimate: 24-32 hours

**Breakdown:**
- Wave 1: Emergency Fixes - 8 hours
- Wave 2: Rate Limiting - 8 hours
- Wave 3: Test Coverage - 8-16 hours
- Wave 4: Environment Validation - 2 hours

### Pre-Launch Checklist

Before launching to public:

**Security:**
- [ ] Exposed API key rotated
- [ ] API key authentication uses bcrypt.compare()
- [ ] Clerk webhooks verify signatures
- [ ] Stripe webhooks have generic errors
- [ ] Rate limiting on all API endpoints
- [ ] Environment variables validated at startup
- [ ] All secrets in .env (not .env.example)
- [ ] .env in .gitignore

**Testing:**
- [ ] Auth tests passing (valid/invalid keys)
- [ ] Webhook tests passing (valid/invalid signatures)
- [ ] Rate limit tests passing
- [ ] Audit creation tests passing
- [ ] `bun test` passes with 0 failures

**Monitoring:**
- [ ] Error tracking configured (Sentry recommended)
- [ ] Log authentication failures
- [ ] Log rate limit hits
- [ ] Log webhook failures
- [ ] Alert on high error rates

### Success Criteria

**Before:** ~60% chance of security breach in first 24 hours

**After:**
- Authentication is functional and secure
- Webhooks cannot be spoofed
- Rate limiting prevents abuse
- Test coverage prevents regressions
- Fail-fast on misconfiguration

**Launch confidence:** 85%+ (from 40%)

---

## Notes

**Cost Considerations:**
- Upstash Redis: $10/mo for rate limiting (worth it for security)
- Sentry: Free tier sufficient to start

**Alternative Approaches:**
- Could use Vercel KV instead of Upstash (similar pricing)
- Could use API Gateway rate limiting if hosting on AWS

**Post-Launch:**
- Monitor rate limit hit rates (tune limits)
- Monitor authentication failure rates (detect attacks)
- Set up automated security scanning (Snyk, Dependabot)
