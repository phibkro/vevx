import { stripe, STRIPE_PRODUCTS } from './config'
import { db } from '@/lib/db'
import { Plan } from '@prisma/client'

export async function createCustomer(email: string, name?: string) {
  return await stripe.customers.create({
    email,
    name,
  })
}

export async function createSubscription(
  customerId: string,
  plan: 'PRO' | 'TEAM'
) {
  const priceId = STRIPE_PRODUCTS[plan].priceId

  return await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: 'default_incomplete',
    payment_settings: { save_default_payment_method: 'on_subscription' },
    expand: ['latest_invoice.payment_intent'],
  })
}

export async function createCheckoutSession(
  teamId: string,
  plan: 'PRO' | 'TEAM',
  successUrl: string,
  cancelUrl: string
) {
  const team = await db.team.findUnique({
    where: { id: teamId },
  })

  if (!team) {
    throw new Error('Team not found')
  }

  let customerId = team.stripeCustomerId

  if (!customerId) {
    const customer = await createCustomer(teamId)
    customerId = customer.id

    await db.team.update({
      where: { id: teamId },
      data: { stripeCustomerId: customerId },
    })
  }

  const priceId = STRIPE_PRODUCTS[plan].priceId

  return await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: {
      teamId,
      plan,
    },
  })
}

export async function createPortalSession(customerId: string, returnUrl: string) {
  return await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  })
}

export function mapStripePlanToPrisma(stripeProductId: string): Plan {
  // This should match your actual Stripe product IDs
  if (stripeProductId.includes('team')) return 'TEAM'
  if (stripeProductId.includes('pro')) return 'PRO'
  return 'FREE'
}
