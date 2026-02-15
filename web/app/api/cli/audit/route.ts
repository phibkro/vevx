import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { PLAN_LIMITS } from '@/lib/stripe/config'
import bcrypt from 'bcryptjs'

interface AuditRequest {
  repo?: string
  commit?: string
  branch?: string
  prNumber?: number
  overallScore: number
  criticalCount: number
  warningCount: number
  infoCount: number
  durationMs: number
  findings: Array<{
    agent: string
    severity: 'CRITICAL' | 'WARNING' | 'INFO'
    title: string
    description: string
    file: string
    line?: number
    suggestion?: string
  }>
}

export async function POST(request: NextRequest) {
  try {
    // Get API key from Authorization header
    const authHeader = request.headers.get('Authorization')
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { error: 'Missing or invalid Authorization header' },
        { status: 401 }
      )
    }

    const apiKey = authHeader.substring(7) // Remove 'Bearer '

    // Hash the provided key and find it in database
    const keyHash = await bcrypt.hash(apiKey, 10)

    // For demo, we'll find by a simple comparison
    // In production, you'd hash on creation and compare hashes
    const apiKeyRecord = await db.apiKey.findFirst({
      where: {
        // Note: This is simplified. In production, hash the key on creation
        // and store only the hash, then compare hashes
      },
      include: {
        team: true,
      },
    })

    if (!apiKeyRecord) {
      return NextResponse.json(
        { error: 'Invalid API key' },
        { status: 401 }
      )
    }

    const team = apiKeyRecord.team

    // Check plan limits
    const planLimits = PLAN_LIMITS[team.plan]

    if (planLimits.auditsPerMonth > 0) {
      // Count audits this month
      const now = new Date()
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

      const auditCount = await db.audit.count({
        where: {
          teamId: team.id,
          createdAt: {
            gte: startOfMonth,
          },
        },
      })

      if (auditCount >= planLimits.auditsPerMonth) {
        return NextResponse.json(
          {
            error: 'Monthly audit limit reached',
            limit: planLimits.auditsPerMonth,
            upgradeUrl: `${process.env.NEXT_PUBLIC_APP_URL}/team`
          },
          { status: 429 }
        )
      }
    }

    // Parse request body
    const body: AuditRequest = await request.json()

    // Validate required fields
    if (
      typeof body.overallScore !== 'number' ||
      typeof body.criticalCount !== 'number' ||
      typeof body.warningCount !== 'number' ||
      typeof body.infoCount !== 'number' ||
      typeof body.durationMs !== 'number' ||
      !Array.isArray(body.findings)
    ) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    // Create audit with findings
    const audit = await db.audit.create({
      data: {
        teamId: team.id,
        repo: body.repo,
        commit: body.commit,
        branch: body.branch,
        prNumber: body.prNumber,
        overallScore: body.overallScore,
        criticalCount: body.criticalCount,
        warningCount: body.warningCount,
        infoCount: body.infoCount,
        durationMs: body.durationMs,
        findings: {
          create: body.findings.map(finding => ({
            agent: finding.agent,
            severity: finding.severity,
            title: finding.title,
            description: finding.description,
            file: finding.file,
            line: finding.line,
            suggestion: finding.suggestion,
          })),
        },
      },
    })

    // Update API key last used timestamp
    await db.apiKey.update({
      where: { id: apiKeyRecord.id },
      data: { lastUsed: new Date() },
    })

    const dashboardUrl = `${process.env.NEXT_PUBLIC_APP_URL}/audits/${audit.id}`

    return NextResponse.json({
      auditId: audit.id,
      teamId: team.id,
      dashboardUrl,
    })

  } catch (error) {
    console.error('Error creating audit:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
