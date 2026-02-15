import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { Webhook } from 'svix'
import { webhookRateLimit } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    // Rate limiting (100 requests per minute globally)
    const identifier = 'clerk-webhook' // Global rate limit
    const { success, limit, remaining, reset } = await webhookRateLimit.limit(identifier)

    if (!success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded' },
        { status: 429 }
      )
    }

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
      }) as any
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
