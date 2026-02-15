import { NextRequest, NextResponse } from 'next/server'
import { getCurrentTeam } from '@/lib/clerk/server'
import { createCheckoutSession } from '@/lib/stripe/helpers'

export async function GET(request: NextRequest) {
  try {
    const team = await getCurrentTeam()
    if (!team) {
      return NextResponse.redirect(new URL('/sign-in', request.url))
    }

    const searchParams = request.nextUrl.searchParams
    const plan = searchParams.get('plan') as 'PRO' | 'TEAM'

    if (!plan || (plan !== 'PRO' && plan !== 'TEAM')) {
      return NextResponse.redirect(new URL('/team', request.url))
    }

    const successUrl = `${process.env.NEXT_PUBLIC_APP_URL}/team?success=true`
    const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL}/team`

    const session = await createCheckoutSession(
      team.id,
      plan,
      successUrl,
      cancelUrl
    )

    return NextResponse.redirect(session.url!)
  } catch (error) {
    console.error('Checkout error:', error)
    return NextResponse.redirect(new URL('/team?error=checkout', request.url))
  }
}
