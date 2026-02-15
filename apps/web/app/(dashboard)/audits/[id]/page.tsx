import { getCurrentTeam } from '@/lib/clerk/server'
import { db } from '@/lib/db'
import { notFound } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDate, getScoreColor, getSeverityColor } from '@/lib/utils'
import { ArrowLeft, AlertCircle, AlertTriangle, Info } from 'lucide-react'
import Link from 'next/link'

interface PageProps {
  params: Promise<{
    id: string
  }>
}

export default async function AuditDetailPage({ params }: PageProps) {
  const { id } = await params
  const team = await getCurrentTeam()
  if (!team) return null

  const audit = await db.audit.findUnique({
    where: {
      id,
      teamId: team.id,
    },
    include: {
      findings: {
        orderBy: [
          { severity: 'asc' }, // CRITICAL first (enum order)
          { agent: 'asc' },
        ],
      },
    },
  })

  if (!audit) {
    notFound()
  }

  // Group findings by agent
  type Finding = typeof audit.findings[number]
  const findingsByAgent = audit.findings.reduce((acc: Record<string, Finding[]>, finding: Finding) => {
    if (!acc[finding.agent]) {
      acc[finding.agent] = []
    }
    acc[finding.agent].push(finding)
    return acc
  }, {} as Record<string, Finding[]>)

  // Calculate agent scores (simplified - in reality, use same logic as CLI)
  const agentScores = Object.keys(findingsByAgent).map(agent => {
    const findings: Finding[] = findingsByAgent[agent]
    const critical = findings.filter((f: Finding) => f.severity === 'CRITICAL').length
    const warning = findings.filter((f: Finding) => f.severity === 'WARNING').length
    const info = findings.filter((f: Finding) => f.severity === 'INFO').length

    // Simple scoring: 100 - (critical * 10 + warning * 5 + info * 1)
    const score = Math.max(0, 100 - (critical * 10 + warning * 5 + info * 1))

    return {
      name: agent,
      score,
      critical,
      warning,
      info,
    }
  })

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center text-sm text-blue-600 hover:text-blue-800 mb-4"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to Dashboard
        </Link>
        <h1 className="text-3xl font-bold text-gray-900">Audit Details</h1>
        <p className="mt-2 text-gray-600">{formatDate(audit.createdAt)}</p>
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle>Audit Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="grid grid-cols-2 gap-4">
            {audit.repo && (
              <div>
                <span className="text-sm font-medium text-gray-500">Repository:</span>
                <p className="text-sm">{audit.repo}</p>
              </div>
            )}
            {audit.branch && (
              <div>
                <span className="text-sm font-medium text-gray-500">Branch:</span>
                <p className="text-sm">
                  <Badge variant="outline">{audit.branch}</Badge>
                </p>
              </div>
            )}
            {audit.commit && (
              <div>
                <span className="text-sm font-medium text-gray-500">Commit:</span>
                <p className="text-sm font-mono text-xs">{audit.commit.substring(0, 8)}</p>
              </div>
            )}
            <div>
              <span className="text-sm font-medium text-gray-500">Duration:</span>
              <p className="text-sm">{(audit.durationMs / 1000).toFixed(1)}s</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Overall Score */}
      <Card>
        <CardHeader>
          <CardTitle>Overall Score</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center space-x-4">
            <div className={`text-6xl font-bold ${getScoreColor(audit.overallScore)}`}>
              {audit.overallScore.toFixed(1)}
            </div>
            <div className="space-y-2">
              <div className="flex items-center space-x-2">
                <AlertCircle className="h-4 w-4 text-red-600" />
                <span className="text-sm">
                  <span className="font-semibold">{audit.criticalCount}</span> Critical
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <AlertTriangle className="h-4 w-4 text-yellow-600" />
                <span className="text-sm">
                  <span className="font-semibold">{audit.warningCount}</span> Warnings
                </span>
              </div>
              <div className="flex items-center space-x-2">
                <Info className="h-4 w-4 text-blue-600" />
                <span className="text-sm">
                  <span className="font-semibold">{audit.infoCount}</span> Info
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Agent Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Agent Scores</CardTitle>
          <CardDescription>Individual scores from each analysis agent</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {agentScores.map(agent => (
              <div key={agent.name} className="border-b pb-4 last:border-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium">{agent.name}</span>
                  <Badge className={getScoreColor(agent.score)}>
                    {agent.score.toFixed(1)}
                  </Badge>
                </div>
                <div className="flex space-x-4 text-sm text-gray-600">
                  <span>Critical: {agent.critical}</span>
                  <span>Warnings: {agent.warning}</span>
                  <span>Info: {agent.info}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Findings */}
      <Card>
        <CardHeader>
          <CardTitle>Findings</CardTitle>
          <CardDescription>All issues found during the audit</CardDescription>
        </CardHeader>
        <CardContent>
          {audit.findings.length === 0 ? (
            <p className="text-center text-gray-500 py-8">No findings</p>
          ) : (
            <div className="space-y-4">
              {audit.findings.map((finding: Finding) => (
                <div key={finding.id} className="border rounded-lg p-4">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <Badge className={getSeverityColor(finding.severity)}>
                          {finding.severity}
                        </Badge>
                        <span className="text-sm text-gray-500">{finding.agent}</span>
                      </div>
                      <h4 className="font-medium text-gray-900">{finding.title}</h4>
                    </div>
                  </div>

                  <p className="text-sm text-gray-600 mb-2">{finding.description}</p>

                  <div className="flex items-center space-x-4 text-xs text-gray-500">
                    <span className="font-mono">{finding.file}</span>
                    {finding.line && <span>Line {finding.line}</span>}
                  </div>

                  {finding.suggestion && (
                    <div className="mt-3 bg-blue-50 border-l-4 border-blue-400 p-3">
                      <p className="text-sm text-blue-900">
                        <span className="font-medium">Suggestion:</span> {finding.suggestion}
                      </p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
