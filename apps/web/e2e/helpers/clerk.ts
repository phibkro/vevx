/**
 * Clerk testing helpers
 *
 * Note: For real GitHub OAuth testing, you'd need Clerk's testing tokens.
 * For now, we'll test the post-auth flows by directly creating users in the DB.
 */

import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function createTestUser(email?: string, plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE' = 'FREE') {
  // Generate unique email if not provided
  const userEmail = email || `test-${Date.now()}-${Math.random().toString(36).substring(7)}@example.com`

  const user = await db.user.create({
    data: {
      clerkId: `test_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      email: userEmail,
      name: 'Test User',
    },
  })

  const team = await db.team.create({
    data: {
      name: `Test User's Team`,
      plan,
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

export async function createTestApiKey(teamId: string, userId: string) {
  const rawKey = `ca_test_${Date.now()}_${Math.random().toString(36).substring(7)}`
  const keyHash = await bcrypt.hash(rawKey, 10)

  await db.apiKey.create({
    data: {
      name: 'Test Key',
      keyHash,
      teamId,
      userId,
    },
  })

  return rawKey
}
