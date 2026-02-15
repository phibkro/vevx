# Test Suite Documentation

## Overview
This directory contains comprehensive tests for security-critical API endpoints in the AI Code Auditor web application.

## Quick Start

```bash
# Install dependencies (if not already installed)
bun install

# Run all tests
bun test

# Run tests with UI
bun test:ui

# Run tests with coverage
bun test:coverage

# Run tests in watch mode
bun test --watch
```

## Directory Structure

```
test/
├── README.md                          # This file
├── setup.ts                           # Global test configuration
├── helpers/
│   ├── api.ts                        # API test utilities
│   └── webhooks.ts                   # Webhook test utilities
├── api/
│   ├── cli/
│   │   └── audit.test.ts            # API key authentication tests
│   └── webhooks/
│       ├── clerk.test.ts            # Clerk webhook tests
│       └── stripe.test.ts           # Stripe webhook tests
└── lib/
    └── rate-limit.test.ts           # Rate limiting tests
```

## Test Categories

### 1. API Key Authentication (`api/cli/audit.test.ts`)
Tests the `/api/cli/audit` endpoint for:
- ✅ Valid API key authentication
- ✅ Invalid API key rejection
- ✅ Missing Authorization header handling
- ✅ Malformed Authorization header handling
- ✅ LastUsed timestamp updates
- ✅ bcrypt.compare usage verification
- ✅ Rate limiting enforcement
- ✅ Audit creation with findings
- ✅ Plan limit enforcement
- ✅ Request body validation

**Run specific suite:**
```bash
bun test test/api/cli/audit.test.ts
```

### 2. Clerk Webhook Verification (`api/webhooks/clerk.test.ts`)
Tests the `/api/webhooks/clerk` endpoint for:
- ✅ Signature verification (valid/invalid)
- ✅ Missing header validation
- ✅ User lifecycle events (create/update/delete)
- ✅ Team creation on user registration
- ✅ Rate limiting

**Run specific suite:**
```bash
bun test test/api/webhooks/clerk.test.ts
```

### 3. Stripe Webhook Verification (`api/webhooks/stripe.test.ts`)
Tests the `/api/webhooks/stripe` endpoint for:
- ✅ Signature verification
- ✅ Generic error messages (security)
- ⚠️ Subscription lifecycle events (needs mock refinement)
- ⚠️ Plan upgrades/downgrades (needs mock refinement)
- ✅ Rate limiting

**Run specific suite:**
```bash
bun test test/api/webhooks/stripe.test.ts
```

### 4. Rate Limiting (`lib/rate-limit.test.ts`)
Tests rate limiting behavior:
- ✅ Success/failure responses
- ✅ Identifier isolation
- ✅ Metadata (limit/remaining/reset)
- ✅ Window reset behavior
- ✅ Configuration validation

**Run specific suite:**
```bash
bun test test/lib/rate-limit.test.ts
```

## Test Utilities

### API Test Helpers (`helpers/api.ts`)

#### `createMockRequest(url, options)`
Creates a mock NextRequest for testing API routes.

```typescript
const request = createMockRequest('http://localhost/api/cli/audit', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer test-key-123',
    'Content-Type': 'application/json',
  },
  body: { /* request body */ },
})
```

#### `createMockDb()`
Creates a mock Prisma database client.

```typescript
const mockDb = createMockDb()
mockDb.user.create.mockResolvedValue(user)
```

#### Test Data Factories
- `createTestApiKey(overrides?)` - Generate test API key data
- `createTestTeam(overrides?)` - Generate test team data
- `createTestUser(overrides?)` - Generate test user data
- `createTestAudit(overrides?)` - Generate test audit data

Example:
```typescript
const team = createTestTeam({ plan: 'PRO' })
const apiKey = createTestApiKey({ teamId: team.id })
```

### Webhook Test Helpers (`helpers/webhooks.ts`)

#### Signature Generation
- `generateClerkSignature(payload, secret, timestamp?)` - Generate Svix signature
- `generateStripeSignature(payload, secret, timestamp?)` - Generate Stripe signature

#### Payload Factories
- `createClerkUserCreatedPayload(overrides?)`
- `createClerkUserUpdatedPayload(overrides?)`
- `createClerkUserDeletedPayload(overrides?)`
- `createStripeCheckoutCompletedPayload(overrides?)`
- `createStripeSubscriptionCreatedPayload(overrides?)`
- `createStripeSubscriptionDeletedPayload(overrides?)`

Example:
```typescript
const payload = createClerkUserCreatedPayload({
  id: 'user_test123',
  email_addresses: [{ email_address: 'test@example.com' }],
})
const { svixId, svixTimestamp, svixSignature } = generateClerkSignature(
  JSON.stringify(payload),
  secret
)
```

## Environment Variables

Test environment variables are configured in `test/setup.ts`. No real credentials needed!

```typescript
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret_key_for_clerk_webhooks_testing'
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_stripe_key_for_testing'
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret_key_for_stripe_webhooks_testing'
process.env.UPSTASH_REDIS_REST_URL = 'https://test.upstash.io'
process.env.UPSTASH_REDIS_REST_TOKEN = 'test_token_123'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
```

## Mocking Strategy

### Database (Prisma)
All database calls are mocked using Vitest's `vi.mock()`:

```typescript
vi.mock('@/lib/db', () => ({
  db: createMockDb(),
}))
```

Usage in tests:
```typescript
const { db } = await import('@/lib/db')
;(db.user.create as any).mockResolvedValue(user)
```

### Rate Limiting (Upstash)
Rate limiter is mocked to avoid Redis calls:

```typescript
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
```

### Webhook Verification
#### Clerk (Svix)
```typescript
vi.mock('svix', () => ({
  Webhook: vi.fn().mockImplementation(() => ({
    verify: vi.fn((payload) => JSON.parse(payload)),
  })),
}))
```

#### Stripe
```typescript
vi.mock('@/lib/stripe/config', () => ({
  stripe: {
    webhooks: {
      constructEvent: vi.fn(),
    },
  },
}))
```

## Writing New Tests

### 1. Create Test File
```typescript
import { describe, test, expect, vi, beforeEach } from 'vitest'
import { POST } from '@/app/api/your-route/route'
import { createMockRequest, createMockDb } from '../../helpers/api'

// Setup mocks
vi.mock('@/lib/db', () => ({
  db: createMockDb(),
}))

describe('Your Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('your test case', async () => {
    // Arrange
    const { db } = await import('@/lib/db')
    ;(db.user.findUnique as any).mockResolvedValue(user)

    // Act
    const response = await POST(request)

    // Assert
    expect(response.status).toBe(200)
  })
})
```

### 2. Test Naming Convention
- Use descriptive test names: `test('valid API key authenticates successfully', ...)`
- Group related tests with `describe()`
- Use `beforeEach()` for common setup

### 3. Assertion Best Practices
```typescript
// Good
expect(response.status).toBe(200)
expect(data).toHaveProperty('auditId')
expect(db.audit.create).toHaveBeenCalledWith(expectedArgs)

// Avoid
expect(response.status).not.toBe(500) // Less clear what's expected
```

## Troubleshooting

### Tests Not Running
```bash
# Clear node_modules and reinstall
rm -rf node_modules
bun install
```

### Mocks Not Working
```bash
# Clear Vitest cache
rm -rf node_modules/.vitest
bun test
```

### Import Errors
Check that `vitest.config.ts` has the correct path alias:
```typescript
resolve: {
  alias: {
    '@': path.resolve(__dirname, './'),
  },
},
```

### Type Errors
Use `as any` for mocked functions:
```typescript
;(db.user.create as any).mockResolvedValue(user)
```

## CI/CD Integration

### GitHub Actions Example
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: oven-sh/setup-bun@v1
      - run: bun install
      - run: bun test --run
```

### Pre-commit Hook
```bash
# .git/hooks/pre-commit
#!/bin/sh
bun test --run
```

## Coverage Reports

Generate coverage reports:
```bash
bun test:coverage
```

Coverage is saved to `./coverage/` directory:
- `coverage/index.html` - HTML report (open in browser)
- `coverage/coverage-final.json` - JSON report
- `coverage/lcov.info` - LCOV report (for CI tools)

## Performance

Tests run fast (<1 second) because:
- All external services are mocked
- No real database connections
- No network requests
- Parallel execution by default

## Best Practices

### 1. Keep Tests Isolated
Each test should be independent:
```typescript
beforeEach(() => {
  vi.clearAllMocks() // Clear all mocks before each test
})
```

### 2. Test Behavior, Not Implementation
```typescript
// Good - tests behavior
expect(response.status).toBe(200)
expect(data.auditId).toBeDefined()

// Less good - tests implementation
expect(bcrypt.compare).toHaveBeenCalled()
```

### 3. Use Descriptive Test Names
```typescript
// Good
test('returns 401 when API key is invalid', ...)

// Less clear
test('test auth', ...)
```

### 4. One Assertion Per Concept
```typescript
// Good - each test validates one thing
test('returns 401 for invalid key', ...)
test('returns 200 for valid key', ...)

// Less good - testing multiple things
test('auth works', () => {
  // tests both success and failure
})
```

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Library](https://testing-library.com/)
- [Next.js Testing](https://nextjs.org/docs/testing)
- [Prisma Testing](https://www.prisma.io/docs/guides/testing)

## Support

For issues or questions:
1. Check this README
2. Check `TEST_SUMMARY.md` in the root of `/web`
3. Review existing test files for examples
4. Check Vitest documentation

## License

Tests are part of the AI Code Auditor project and follow the same license.
