import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe/config'
import { db } from '@/lib/db'
import { mapStripePlanToPrisma } from '@/lib/stripe/helpers'
import Stripe from 'stripe'

export async function POST(request: NextRequest) {
  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json(
      { error: 'Missing signature' },
      { status: 400 }
    )
  }

  let event: Stripe.Event

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!
    )
  } catch (error) {
    console.error('Webhook signature verification failed:', error)
    return NextResponse.json(
      { error: 'Invalid signature' },
      { status: 400 }
    )
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session
        const teamId = session.metadata?.teamId

        if (!teamId) {
          console.error('No teamId in session metadata')
          break
        }

        await db.team.update({
          where: { id: teamId },
          data: {
            stripeCustomerId: session.customer as string,
            stripeSubscriptionId: session.subscription as string,
          },
        })
        break
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription

        const team = await db.team.findUnique({
          where: { stripeCustomerId: subscription.customer as string },
        })

        if (!team) {
          console.error('Team not found for customer:', subscription.customer)
          break
        }

        const productId = subscription.items.data[0]?.price.product as string
        const plan = mapStripePlanToPrisma(productId)

        await db.team.update({
          where: { id: team.id },
          data: {
            plan,
            stripeSubscriptionId: subscription.id,
            stripeProductId: productId,
            stripePriceId: subscription.items.data[0]?.price.id,
          },
        })
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription

        const team = await db.team.findUnique({
          where: { stripeCustomerId: subscription.customer as string },
        })

        if (!team) {
          console.error('Team not found for customer:', subscription.customer)
          break
        }

        await db.team.update({
          where: { id: team.id },
          data: {
            plan: 'FREE',
            stripeSubscriptionId: null,
            stripeProductId: null,
            stripePriceId: null,
          },
        })
        break
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object as Stripe.Invoice
        console.log('Payment succeeded for invoice:', invoice.id)
        // Could send confirmation email, update analytics, etc.
        break
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice
        console.log('Payment failed for invoice:', invoice.id)
        // Could send notification email, mark account as past due, etc.
        break
      }

      default:
        console.log('Unhandled event type:', event.type)
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Error processing webhook:', error)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    )
  }
}
