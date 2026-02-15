import { NextRequest } from 'next/server'
import { vi } from 'vitest'

/**
 * Create a mock NextRequest for testing API routes
 */
export function createMockRequest(
  url: string,
  options: {
    method?: string
    headers?: Record<string, string>
    body?: any
  } = {}
): NextRequest {
  const { method = 'GET', headers = {}, body } = options

  const requestInit = {
    method,
    headers: new Headers(headers),
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  }

  return new NextRequest(url, requestInit)
}

/**
 * Mock Prisma database client for testing
 */
export function createMockDb() {
  return {
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
  }
}

/**
 * Create test data for API key
 */
export function createTestApiKey(overrides = {}) {
  return {
    id: 'test-api-key-id',
    teamId: 'test-team-id',
    userId: 'test-user-id',
    name: 'Test API Key',
    keyHash: 'hashed-key',
    lastUsed: null,
    createdAt: new Date(),
    ...overrides,
  }
}

/**
 * Create test data for team
 */
export function createTestTeam(overrides = {}) {
  return {
    id: 'test-team-id',
    name: 'Test Team',
    plan: 'PRO' as const,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripeProductId: null,
    stripePriceId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

/**
 * Create test data for user
 */
export function createTestUser(overrides = {}) {
  return {
    id: 'test-user-id',
    clerkId: 'clerk_test_user_123',
    email: 'test@example.com',
    name: 'Test User',
    createdAt: new Date(),
    ...overrides,
  }
}

/**
 * Create test data for audit
 */
export function createTestAudit(overrides = {}) {
  return {
    id: 'test-audit-id',
    teamId: 'test-team-id',
    repo: 'test/repo',
    commit: 'abc123',
    branch: 'main',
    prNumber: null,
    overallScore: 8.5,
    criticalCount: 0,
    warningCount: 2,
    infoCount: 5,
    durationMs: 1000,
    createdAt: new Date(),
    ...overrides,
  }
}
