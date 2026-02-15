import { getCurrentTeam } from '@/lib/clerk/server'
import { db } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { PLAN_LIMITS } from '@/lib/stripe/config'
import Link from 'next/link'

export default async function TeamPage() {
  const team = await getCurrentTeam()
  if (!team) return null

  const members = await db.teamMember.findMany({
    where: { teamId: team.id },
    include: {
      user: true,
    },
    orderBy: {
      role: 'asc', // OWNER first
    },
  })

  type Member = typeof members[number]

  // Get audit count for current month
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

  const planLimits = PLAN_LIMITS[team.plan as keyof typeof PLAN_LIMITS]

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Team Settings</h1>
        <p className="mt-2 text-gray-600">Manage your team and billing</p>
      </div>

      {/* Current Plan */}
      <Card>
        <CardHeader>
          <CardTitle>Current Plan</CardTitle>
          <CardDescription>Your subscription and usage</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center space-x-3">
                <h3 className="text-2xl font-bold">{team.plan}</h3>
                {team.plan === 'FREE' && (
                  <Badge variant="outline">Free</Badge>
                )}
                {team.plan === 'PRO' && (
                  <Badge className="bg-blue-100 text-blue-800">$29/mo</Badge>
                )}
                {team.plan === 'TEAM' && (
                  <Badge className="bg-purple-100 text-purple-800">$149/mo</Badge>
                )}
              </div>
              <div className="mt-2 space-y-1 text-sm text-gray-600">
                <p>
                  Audits this month: <span className="font-semibold">{auditCount}</span>
                  {planLimits.auditsPerMonth > 0 && (
                    <span> / {planLimits.auditsPerMonth}</span>
                  )}
                  {planLimits.auditsPerMonth === -1 && (
                    <span> / unlimited</span>
                  )}
                </p>
                <p>
                  Team members: <span className="font-semibold">{members.length}</span>
                  {planLimits.teamMembers > 0 && (
                    <span> / {planLimits.teamMembers}</span>
                  )}
                  {planLimits.teamMembers === -1 && (
                    <span> / unlimited</span>
                  )}
                </p>
              </div>
            </div>
            <div className="space-x-2">
              {team.plan === 'FREE' && (
                <>
                  <Link href="/api/checkout?plan=PRO">
                    <Button variant="outline">Upgrade to Pro</Button>
                  </Link>
                  <Link href="/api/checkout?plan=TEAM">
                    <Button>Upgrade to Team</Button>
                  </Link>
                </>
              )}
              {team.plan === 'PRO' && (
                <Link href="/api/checkout?plan=TEAM">
                  <Button>Upgrade to Team</Button>
                </Link>
              )}
              {(team.plan === 'PRO' || team.plan === 'TEAM') && team.stripeCustomerId && (
                <form action="/api/billing/portal" method="POST">
                  <Button variant="outline" type="submit">
                    Manage Billing
                  </Button>
                </form>
              )}
            </div>
          </div>

          {/* Usage Warning */}
          {team.plan === 'FREE' && auditCount >= planLimits.auditsPerMonth && (
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-4">
              <p className="text-sm text-yellow-800">
                You&apos;ve reached your monthly limit. Upgrade to continue running audits.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Team Members */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Team Members</CardTitle>
              <CardDescription>People who have access to this team</CardDescription>
            </div>
            {(team.plan === 'TEAM' || team.plan === 'ENTERPRISE') && (
              <Button disabled>Invite Member</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member: Member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.user.name || 'Unknown'}
                  </TableCell>
                  <TableCell>{member.user.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{member.role}</Badge>
                  </TableCell>
                  <TableCell>
                    {member.role !== 'OWNER' && (
                      <Button variant="ghost" size="sm" disabled>
                        Remove
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {team.plan === 'FREE' && (
            <div className="mt-4 text-sm text-gray-500">
              Upgrade to Team plan to invite more members
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      {team.plan === 'FREE' && (
        <Card>
          <CardHeader>
            <CardTitle>Upgrade Your Plan</CardTitle>
            <CardDescription>Get more features and higher limits</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 md:grid-cols-3">
              {/* Free */}
              <div className="border rounded-lg p-6">
                <h4 className="font-semibold text-lg">Free</h4>
                <p className="text-3xl font-bold mt-2">$0</p>
                <ul className="mt-4 space-y-2 text-sm">
                  <li>✓ 5 audits/month</li>
                  <li>✓ Public repos only</li>
                  <li>✓ Basic dashboard</li>
                  <li>✗ Team features</li>
                </ul>
              </div>

              {/* Pro */}
              <div className="border-2 border-blue-500 rounded-lg p-6">
                <h4 className="font-semibold text-lg">Pro</h4>
                <p className="text-3xl font-bold mt-2">$29<span className="text-sm font-normal">/mo</span></p>
                <ul className="mt-4 space-y-2 text-sm">
                  <li>✓ Unlimited audits</li>
                  <li>✓ Private repos</li>
                  <li>✓ Advanced analytics</li>
                  <li>✗ Team features</li>
                </ul>
                <Link href="/api/checkout?plan=PRO" className="mt-4 block">
                  <Button className="w-full">Upgrade to Pro</Button>
                </Link>
              </div>

              {/* Team */}
              <div className="border-2 border-purple-500 rounded-lg p-6">
                <h4 className="font-semibold text-lg">Team</h4>
                <p className="text-3xl font-bold mt-2">$149<span className="text-sm font-normal">/mo</span></p>
                <ul className="mt-4 space-y-2 text-sm">
                  <li>✓ Everything in Pro</li>
                  <li>✓ 5 team members</li>
                  <li>✓ Team dashboard</li>
                  <li>✓ Audit history</li>
                </ul>
                <Link href="/api/checkout?plan=TEAM" className="mt-4 block">
                  <Button className="w-full">Upgrade to Team</Button>
                </Link>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
