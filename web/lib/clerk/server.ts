import { auth } from '@clerk/nextjs/server'
import { db } from '@/lib/db'

export async function getCurrentUser() {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  return await db.user.findUnique({
    where: { clerkId: userId },
    include: {
      teamMemberships: {
        include: {
          team: true,
        },
      },
    },
  })
}

export async function getCurrentTeam() {
  const user = await getCurrentUser()

  if (!user || user.teamMemberships.length === 0) {
    return null
  }

  // For now, return the first team membership
  // In the future, we might let users switch between teams
  return user.teamMemberships[0].team
}

export async function requireAuth() {
  const user = await getCurrentUser()

  if (!user) {
    throw new Error('Unauthorized')
  }

  return user
}

export async function requireTeam() {
  const team = await getCurrentTeam()

  if (!team) {
    throw new Error('No team found')
  }

  return team
}
