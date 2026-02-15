import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json()
    const { type, data } = payload

    switch (type) {
      case 'user.created': {
        const { id, email_addresses, first_name, last_name } = data

        const email = email_addresses[0]?.email_address
        const name = [first_name, last_name].filter(Boolean).join(' ') || undefined

        // Create user
        const user = await db.user.create({
          data: {
            clerkId: id,
            email,
            name,
          },
        })

        // Create a default team for the user
        const team = await db.team.create({
          data: {
            name: `${name || email}'s Team`,
            plan: 'FREE',
            members: {
              create: {
                userId: user.id,
                role: 'OWNER',
              },
            },
          },
        })

        console.log('Created user and team:', { userId: user.id, teamId: team.id })
        break
      }

      case 'user.updated': {
        const { id, email_addresses, first_name, last_name } = data

        const email = email_addresses[0]?.email_address
        const name = [first_name, last_name].filter(Boolean).join(' ') || undefined

        await db.user.update({
          where: { clerkId: id },
          data: {
            email,
            name,
          },
        })
        break
      }

      case 'user.deleted': {
        const { id } = data

        // Delete user (cascade will handle team memberships, API keys, etc.)
        await db.user.delete({
          where: { clerkId: id },
        })
        break
      }

      default:
        console.log('Unhandled Clerk event type:', type)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing Clerk webhook:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
