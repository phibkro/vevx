import { auth, currentUser } from '@clerk/nextjs/server'
import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export async function getCurrentUser() {
  const { userId } = await auth()

  if (!userId) {
    return null
  }

  // Try to find existing user
  let user = await db.user.findUnique({
    where: { clerkId: userId },
    include: {
      teamMemberships: {
        include: {
          team: true,
        },
      },
    },
  })

  // If user doesn't exist, create them (first sign-in)
  if (!user) {
    const clerkUser = await currentUser()

    if (!clerkUser) {
      return null
    }

    // Create user and team in a transaction
    user = await db.$transaction(async (tx: Prisma.TransactionClient) => {
      // Upsert the user (in case they were created between our check and now)
      const newUser = await tx.user.upsert({
        where: { clerkId: userId },
        update: {
          email: clerkUser.emailAddresses[0]?.emailAddress || '',
          name: clerkUser.firstName && clerkUser.lastName
            ? `${clerkUser.firstName} ${clerkUser.lastName}`
            : clerkUser.username || 'User',
        },
        create: {
          clerkId: userId,
          email: clerkUser.emailAddresses[0]?.emailAddress || '',
          name: clerkUser.firstName && clerkUser.lastName
            ? `${clerkUser.firstName} ${clerkUser.lastName}`
            : clerkUser.username || 'User',
        },
      })

      // Check if user already has a team
      const existingMembership = await tx.teamMember.findFirst({
        where: { userId: newUser.id },
      })

      if (!existingMembership) {
        // Create a default team
        const team = await tx.team.create({
          data: {
            name: `${newUser.name}'s Team`,
            plan: 'FREE',
          },
        })

        // Create team membership
        await tx.teamMember.create({
          data: {
            userId: newUser.id,
            teamId: team.id,
            role: 'OWNER',
          },
        })
      }

      // Return user with team membership
      return await tx.user.findUnique({
        where: { id: newUser.id },
        include: {
          teamMemberships: {
            include: {
              team: true,
            },
          },
        },
      })
    })
  }

  return user
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
