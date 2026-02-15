import { NextRequest, NextResponse } from 'next/server'
import { getCurrentTeam } from '@/lib/clerk/server'
import { createPortalSession } from '@/lib/stripe/helpers'

export async function POST(request: NextRequest) {
  try {
    const team = await getCurrentTeam()
    if (!team || !team.stripeCustomerId) {
      return NextResponse.redirect(new URL('/team', request.url))
    }

    const returnUrl = `${process.env.NEXT_PUBLIC_APP_URL}/team`

    const session = await createPortalSession(team.stripeCustomerId, returnUrl)

    return NextResponse.redirect(session.url)
  } catch (error) {
    console.error('Portal error:', error)
    return NextResponse.redirect(new URL('/team?error=portal', request.url))
  }
}
