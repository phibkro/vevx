import { getCurrentTeam } from '@/lib/clerk/server'
import { db } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate, getScoreBadgeColor } from '@/lib/utils'
import Link from 'next/link'

export default async function AuditsPage() {
  const team = await getCurrentTeam()
  if (!team) return null

  const audits = await db.audit.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: 'desc' },
    take: 50, // Show last 50 audits
  })

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Audit History</h1>
        <p className="mt-2 text-gray-600">
          All code quality audits for your team
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Audits</CardTitle>
          <CardDescription>
            Showing {audits.length} most recent audit{audits.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {audits.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500 mb-4">No audits yet</p>
              <p className="text-sm text-gray-400">
                Run your first audit using the CLI to see it here
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Commit</TableHead>
                  <TableHead>Score</TableHead>
                  <TableHead>Issues</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {audits.map((audit: typeof audits[number]) => (
                  <TableRow key={audit.id}>
                    <TableCell className="text-gray-500">
                      {formatDate(audit.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {audit.repo ? (
                        <span className="text-sm">{audit.repo.split('/').pop()?.replace('.git', '')}</span>
                      ) : (
                        <span className="text-gray-400 text-sm">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {audit.branch ? (
                        <Badge variant="outline" className="text-xs">
                          {audit.branch}
                        </Badge>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {audit.commit ? (
                        <code className="text-xs bg-gray-100 px-2 py-1 rounded">
                          {audit.commit.substring(0, 7)}
                        </code>
                      ) : (
                        <span className="text-gray-400 text-sm">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={getScoreBadgeColor(audit.overallScore)}>
                        {audit.overallScore.toFixed(1)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex space-x-2 text-xs">
                        {audit.criticalCount > 0 && (
                          <span className="text-red-600 font-semibold">
                            {audit.criticalCount}C
                          </span>
                        )}
                        {audit.warningCount > 0 && (
                          <span className="text-yellow-600 font-semibold">
                            {audit.warningCount}W
                          </span>
                        )}
                        {audit.infoCount > 0 && (
                          <span className="text-blue-600 font-semibold">
                            {audit.infoCount}I
                          </span>
                        )}
                        {audit.criticalCount === 0 && audit.warningCount === 0 && audit.infoCount === 0 && (
                          <span className="text-gray-400">None</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-500 text-sm">
                      {(audit.durationMs / 1000).toFixed(1)}s
                    </TableCell>
                    <TableCell>
                      <Link
                        href={`/audits/${audit.id}`}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
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
