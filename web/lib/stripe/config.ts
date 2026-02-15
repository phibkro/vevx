import Stripe from 'stripe'

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('Missing STRIPE_SECRET_KEY')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-11-20.acacia',
  typescript: true,
})

// Product IDs - these should match your Stripe dashboard
export const STRIPE_PRODUCTS = {
  PRO: {
    priceId: process.env.STRIPE_PRO_PRICE_ID || 'price_pro_monthly',
    amount: 2900, // $29.00
  },
  TEAM: {
    priceId: process.env.STRIPE_TEAM_PRICE_ID || 'price_team_monthly',
    amount: 14900, // $149.00
  },
}

// Plan limits
export const PLAN_LIMITS = {
  FREE: {
    auditsPerMonth: 5,
    teamMembers: 1,
  },
  PRO: {
    auditsPerMonth: -1, // unlimited
    teamMembers: 1,
  },
  TEAM: {
    auditsPerMonth: -1, // unlimited
    teamMembers: 5,
  },
  ENTERPRISE: {
    auditsPerMonth: -1, // unlimited
    teamMembers: -1, // unlimited
  },
}
