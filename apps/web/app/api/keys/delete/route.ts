import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser, getCurrentTeam } from '@/lib/clerk/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser()
    const team = await getCurrentTeam()

    if (!user || !team) {
      return NextResponse.redirect(new URL('/sign-in', request.url))
    }

    const formData = await request.formData()
    const keyId = formData.get('keyId') as string

    if (!keyId) {
      return NextResponse.redirect(
        new URL('/settings/api-keys?error=invalid', request.url)
      )
    }

    // Verify the key belongs to this team
    const apiKey = await db.apiKey.findUnique({
      where: { id: keyId },
    })

    if (!apiKey || apiKey.teamId !== team.id) {
      return NextResponse.redirect(
        new URL('/settings/api-keys?error=notfound', request.url)
      )
    }

    // Delete the key
    await db.apiKey.delete({
      where: { id: keyId },
    })

    return NextResponse.redirect(
      new URL('/settings/api-keys?success=deleted', request.url)
    )
  } catch (error) {
    console.error('Error deleting API key:', error)
    return NextResponse.redirect(
      new URL('/settings/api-keys?error=delete', request.url)
    )
  }
}
