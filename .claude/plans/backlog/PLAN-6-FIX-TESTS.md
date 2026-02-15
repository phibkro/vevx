# Implementation Plan: Fix Failing Tests

**Priority:** 🔴 CRITICAL - Blocks CI/CD (PLAN-9)
**Scope:** apps/web
**Agent Strategy:** Single agent, sequential tasks with role changes
**Estimated Time:** 4-6 hours
**Branch:** `fix/test-suite`

## Agent Execution

```
web-001 (spawn new):
  Role: Builder
  Tasks:
    1. Fix mock database (6 tests) [2h]
    2. Fix rate limiting (5 tests) [1h]
    3. Fix webhook signatures (3 tests) [1-2h]

web-001 (RESUME):
  Role: Tester
  Tasks:
    4. Verify all 45 tests pass
    5. Check for flaky tests
```

**Context built:** Test patterns, mock setup, API structure
**Reused in:** PLAN-9 (CI/CD setup)

## Overview

Fix 14 failing web dashboard tests to restore confidence in test suite and enable reliable CI/CD.

**Current State:**
- CLI tests: 5/5 passing ✅
- Web tests: 31/45 passing (14 failing) ❌
- Main issues: Mock configurations, rate limiting, signature verification

**Target State:**
- All tests passing
- Reliable test suite for CI/CD
- Foundation for adding more tests

---

## Current Test Failures

### Mock Database Issues (6 failures)
**Problem**: Mock functions not properly tracked by Vitest
```typescript
// Error: db.apiKey.findMany.toHaveBeenCalled is not a function
expect(db.apiKey.findMany).toHaveBeenCalled()
```

**Files affected:**
- `test/api/cli/audit.test.ts` (2 failures)
- `test/api/webhooks/stripe.test.ts` (3 failures)
- `test/api/webhooks/clerk.test.ts` (1 failure)

**Root cause**: Async mock factory doesn't preserve vi.fn() spy capabilities

**Solution**:
1. Import mocked db in test setup
2. Use `vi.mocked()` to get typed mock
3. Or restructure to use `beforeEach` for mock setup

**Effort**: 2 hours

---

### Rate Limiting Issues (5 failures)
**Problem**: Tests expect specific status codes but get 429 (rate limited)
```typescript
// Expected: 200
// Received: 429
expect(response.status).toBe(200)
```

**Files affected:**
- `test/api/cli/audit.test.ts` (3 failures)
- Other API tests (2 failures)

**Root cause**: Rate limit mocks not properly configured or test order dependent

**Solution**:
1. Ensure rate limit mocks are set up in `beforeEach`
2. Reset mocks between tests
3. Or disable rate limiting in test environment

**Effort**: 1 hour

---

### Webhook Signature Verification (3 failures)
**Problem**: Mock signature verification too strict or incorrect test data
```typescript
// Error: Invalid signature
// Svix mock rejecting valid test signatures
```

**Files affected:**
- `test/api/webhooks/clerk.test.ts`
- `test/api/webhooks/stripe.test.ts`

**Root cause**: Test helpers generating incorrect signature format

**Solution**:
1. Fix mock Webhook implementation to match real behavior
2. Update test helpers to generate correct signatures
3. Or simplify mock to just check headers exist

**Effort**: 1-2 hours

---

## Implementation Waves

### Wave 1: Fix Mock Database (2h)
**Goal**: All database mock assertions work

1. **Update test helpers**
   - Add `getMockedDb()` helper that returns properly typed mocks
   - Ensure mocks are reset in `beforeEach`

2. **Update affected tests**
   - Replace direct `db` usage with `getMockedDb()`
   - Use `vi.mocked(db.team.update)` for assertions
   - Verify mocks are actually being called

3. **Verify**
   - Run tests: `cd apps/web && bun test`
   - Should fix 6 failures

**Files to change:**
- `test/helpers/api.ts` - Add getMockedDb helper
- `test/api/cli/audit.test.ts`
- `test/api/webhooks/stripe.test.ts`
- `test/api/webhooks/clerk.test.ts`

---

### Wave 2: Fix Rate Limiting (1h)
**Goal**: Tests don't get rate limited

1. **Fix mock setup**
   - Ensure `auditRateLimit.limit()` mock returns success in `beforeEach`
   - Reset all mocks between tests

2. **Update test environment**
   - Consider adding `SKIP_RATE_LIMIT=true` env var for tests
   - Or ensure mocks are properly isolated

3. **Verify**
   - Run tests: `cd apps/web && bun test`
   - Should fix 5 failures

**Files to change:**
- `test/api/cli/audit.test.ts`
- Possibly add env var to `lib/rate-limit.ts`

---

### Wave 3: Fix Webhook Signatures (1-2h)
**Goal**: Webhook tests pass signature verification

1. **Simplify Svix mock**
   - Just check headers exist, don't actually verify signature
   - Or implement proper signature generation in helpers

2. **Update Stripe mock**
   - Ensure `stripe.webhooks.constructEvent` mock is properly configured

3. **Fix test data**
   - Update `generateClerkSignature()` helper
   - Update `generateStripeSignature()` helper

4. **Verify**
   - Run tests: `cd apps/web && bun test`
   - Should fix 3 failures

**Files to change:**
- `test/helpers/webhooks.ts`
- `test/api/webhooks/clerk.test.ts`
- `test/api/webhooks/stripe.test.ts`

---

## Acceptance Criteria

- [ ] All 45 web tests passing
- [ ] Tests run reliably (not flaky)
- [ ] CI/CD can use test suite
- [ ] Documentation updated with testing patterns

---

## Benefits

**Quality**:
- Confidence in changes
- Catch regressions early
- Foundation for more tests

**Velocity**:
- Safe refactoring
- Faster PR reviews
- Automated quality checks

**Business**:
- Fewer bugs in production
- Better customer experience
- Reduced support burden

---

## Risks & Mitigations

**Risk**: Tests become flaky
- **Mitigation**: Ensure proper mock isolation between tests

**Risk**: Takes longer than estimated
- **Mitigation**: Focus on high-value tests first, defer edge cases

**Risk**: Tests pass but don't catch real bugs
- **Mitigation**: Verify mocks match real behavior, add integration tests later

---

## Follow-up Work

After this plan:
- Add missing test coverage (see PLAN-7)
- Add E2E tests for critical flows
- Set up CI/CD with test gates
