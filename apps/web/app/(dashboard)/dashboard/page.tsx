import { getCurrentTeam } from '@/lib/clerk/server'
import { db } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatRelativeTime, getScoreColor, getScoreBadgeColor } from '@/lib/utils'
import Link from 'next/link'
import { ArrowUpIcon, ArrowDownIcon, MinusIcon } from 'lucide-react'

async function getTeamStats(teamId: string) {
  const thirtyDaysAgo = new Date()
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30)

  const audits = await db.audit.findMany({
    where: {
      teamId,
      createdAt: {
        gte: thirtyDaysAgo,
      },
    },
    orderBy: {
      createdAt: 'desc',
    },
    include: {
      findings: true,
    },
  })

  type Audit = typeof audits[number]

  const totalAudits = audits.length
  const averageScore = audits.length > 0
    ? audits.reduce((sum: number, audit: Audit) => sum + audit.overallScore, 0) / audits.length
    : 0

  const totalCritical = audits.reduce((sum: number, audit: Audit) => sum + audit.criticalCount, 0)

  // Calculate trend (comparing last 7 days vs previous 7 days)
  const sevenDaysAgo = new Date()
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

  const recentAudits = audits.filter((a: Audit) => a.createdAt >= sevenDaysAgo)
  const previousAudits = audits.filter(
    (a: Audit) => a.createdAt < sevenDaysAgo && a.createdAt >= thirtyDaysAgo
  )

  const recentAvg = recentAudits.length > 0
    ? recentAudits.reduce((sum: number, audit: Audit) => sum + audit.overallScore, 0) / recentAudits.length
    : 0

  const previousAvg = previousAudits.length > 0
    ? previousAudits.reduce((sum: number, audit: Audit) => sum + audit.overallScore, 0) / previousAudits.length
    : 0

  let trend: 'up' | 'down' | 'stable' = 'stable'
  if (recentAvg > previousAvg + 2) trend = 'up'
  else if (recentAvg < previousAvg - 2) trend = 'down'

  return {
    totalAudits,
    averageScore,
    totalCritical,
    trend,
    recentAudits: audits.slice(0, 10),
  }
}

export default async function DashboardPage() {
  const team = await getCurrentTeam()
  if (!team) return null

  const stats = await getTeamStats(team.id)

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-2 text-gray-600">
          Overview of your team's code quality metrics
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Overall Score</CardTitle>
            {stats.trend === 'up' && <ArrowUpIcon className="h-4 w-4 text-green-600" />}
            {stats.trend === 'down' && <ArrowDownIcon className="h-4 w-4 text-red-600" />}
            {stats.trend === 'stable' && <MinusIcon className="h-4 w-4 text-gray-600" />}
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${getScoreColor(stats.averageScore)}`}>
              {stats.averageScore.toFixed(1)}
            </div>
            <p className="text-xs text-muted-foreground">
              {stats.trend === 'up' && 'Improving'}
              {stats.trend === 'down' && 'Declining'}
              {stats.trend === 'stable' && 'Stable'}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Audits</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalAudits}</div>
            <p className="text-xs text-muted-foreground">Last 30 days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Critical Issues</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{stats.totalCritical}</div>
            <p className="text-xs text-muted-foreground">Requires attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Current Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{team.plan}</div>
            <p className="text-xs text-muted-foreground">
              {team.plan === 'FREE' && '5 audits/month'}
              {team.plan === 'PRO' && 'Unlimited audits'}
              {team.plan === 'TEAM' && 'Team features'}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Audits */}
      <Card>
        <CardHeader>
          <CardTitle>Recent Audits</CardTitle>
          <CardDescription>Latest code quality audits from your team</CardDescription>
        </CardHeader>
        <CardContent>
          {stats.recentAudits.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              No audits yet. Run your first audit using the CLI.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Repository</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Critical</TableHead>
                  <TableHead>Time</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.recentAudits.map((audit: typeof stats.recentAudits[number]) => (
                  <TableRow key={audit.id}>
                    <TableCell className="font-medium">
                      {audit.repo || 'Unknown'}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{audit.branch || 'main'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge className={getScoreBadgeColor(audit.overallScore)}>
                        {audit.overallScore.toFixed(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {audit.criticalCount > 0 ? (
                        <span className="text-red-600 font-semibold">
                          {audit.criticalCount}
                        </span>
                      ) : (
                        <span className="text-gray-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {formatRelativeTime(audit.createdAt)}
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/audits/${audit.id}`}
                        className="text-blue-600 hover:text-blue-800 text-sm"
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
