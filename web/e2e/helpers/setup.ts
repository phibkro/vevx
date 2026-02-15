import { test as base, expect } from '@playwright/test'
import { db } from '@/lib/db'
import { Redis } from '@upstash/redis'

// Create Redis client for cleanup
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

async function cleanupTestData() {
  // Get API keys before deleting to clean up rate limits
  const apiKeys = await db.apiKey.findMany({
    where: {
      team: {
        name: {
          contains: 'Test'
        }
      }
    }
  })

  // Clean up rate limit keys in Redis
  for (const key of apiKeys) {
    const rateLimitKey = `@upstash/ratelimit/audit:${key.id}`
    try {
      await redis.del(rateLimitKey)
    } catch (error) {
      // Ignore errors
    }
  }

  // Clean up test data
  // Delete in order to respect foreign key constraints
  await db.audit.deleteMany({
    where: {
      team: {
        name: {
          contains: 'Test'
        }
      }
    }
  })

  await db.apiKey.deleteMany({
    where: {
      team: {
        name: {
          contains: 'Test'
        }
      }
    }
  })

  await db.teamMember.deleteMany({
    where: {
      team: {
        name: {
          contains: 'Test'
        }
      }
    }
  })

  await db.team.deleteMany({
    where: {
      name: {
        contains: 'Test'
      }
    }
  })

  await db.user.deleteMany({
    where: {
      email: {
        contains: 'test@'
      }
    }
  })
}

// Extend base test with custom fixtures
export const test = base.extend({
  // Auto-cleanup database before and after each test
  cleanDb: async ({}, use) => {
    // Clean up BEFORE test (in case previous test failed)
    await cleanupTestData()
    await use()
    await cleanupTestData()
  },
})

export { expect }
