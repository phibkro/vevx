import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, getCurrentTeam } from '@/lib/clerk/server'
import { db } from '@/lib/db'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    const team = await getCurrentTeam()

    if (!user || !team) {
      return NextResponse.redirect(new URL('/sign-in', request.url))
    }

    // Generate a random API key
    const apiKey = `ca_${crypto.randomBytes(32).toString('hex')}`

    // Hash the key before storing
    const keyHash = await bcrypt.hash(apiKey, 10)

    // Create API key record
    await db.apiKey.create({
      data: {
        teamId: team.id,
        userId: user.id,
        name: apiKey.substring(0, 16) + '...',
        keyHash,
      },
    })

    // Redirect to settings page with the key as a query param (one-time display)
    return NextResponse.redirect(
      new URL(`/settings/api-keys?newKey=${apiKey}`, request.url)
    )
  } catch (error) {
    console.error('Error creating API key:', error)
    return NextResponse.redirect(
      new URL('/settings/api-keys?error=create', request.url)
    )
  }
}
