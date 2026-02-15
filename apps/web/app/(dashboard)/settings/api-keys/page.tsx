import { getCurrentUser, getCurrentTeam } from '@/lib/clerk/server'
import { db } from '@/lib/db'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { formatRelativeTime } from '@/lib/utils'
import { NewApiKeyDialog } from '@/components/dashboard/new-api-key-dialog'

export default async function ApiKeysPage() {
  const user = await getCurrentUser()
  const team = await getCurrentTeam()
  if (!user || !team) return null

  const apiKeys = await db.apiKey.findMany({
    where: { teamId: team.id },
    orderBy: { createdAt: 'desc' },
    include: {
      user: true,
    },
  })

  return (
    <div className="space-y-8">
      <NewApiKeyDialog />
      <div>
        <h1 className="text-3xl font-bold text-gray-900">API Keys</h1>
        <p className="mt-2 text-gray-600">
          Manage API keys for CLI integration
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Your API Keys</CardTitle>
              <CardDescription>
                Use these keys to authenticate the CLI tool
              </CardDescription>
            </div>
            <form action="/api/keys/create" method="POST">
              <Button type="submit">Create New Key</Button>
            </form>
          </div>
        </CardHeader>
        <CardContent>
          {apiKeys.length === 0 ? (
            <div className="text-center py-8 text-gray-500">
              No API keys yet. Create one to use the CLI.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Created By</TableHead>
                  <TableHead>Last Used</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((key) => (
                  <TableRow key={key.id}>
                    <TableCell className="font-medium font-mono text-sm">
                      {key.name}
                    </TableCell>
                    <TableCell>{key.user.email}</TableCell>
                    <TableCell className="text-gray-500">
                      {key.lastUsed ? formatRelativeTime(key.lastUsed) : 'Never'}
                    </TableCell>
                    <TableCell className="text-gray-500">
                      {formatRelativeTime(key.createdAt)}
                    </TableCell>
                    <TableCell>
                      <form action="/api/keys/delete" method="POST" className="inline">
                        <input type="hidden" name="keyId" value={key.id} />
                        <Button variant="ghost" size="sm" type="submit">
                          Revoke
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="mt-6 rounded-lg bg-blue-50 border border-blue-200 p-4">
            <h4 className="font-medium text-blue-900 mb-2">Using the CLI</h4>
            <p className="text-sm text-blue-800 mb-2">
              Set your API key as an environment variable:
            </p>
            <pre className="bg-blue-900 text-blue-100 p-3 rounded text-xs overflow-x-auto">
              export CODE_AUDITOR_API_KEY=your_api_key_here
            </pre>
            <p className="text-sm text-blue-800 mt-2">
              Then run audits normally. Results will automatically sync to your dashboard.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
