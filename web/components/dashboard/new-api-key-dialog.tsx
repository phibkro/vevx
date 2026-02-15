'use client'

import { useEffect, useState } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Copy, CheckCircle } from 'lucide-react'

export function NewApiKeyDialog() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [copied, setCopied] = useState(false)

  const newKey = searchParams.get('newKey')

  useEffect(() => {
    if (copied) {
      const timeout = setTimeout(() => setCopied(false), 2000)
      return () => clearTimeout(timeout)
    }
  }, [copied])

  if (!newKey) {
    return null
  }

  const copyToClipboard = async () => {
    await navigator.clipboard.writeText(newKey)
    setCopied(true)
  }

  const dismiss = () => {
    router.push('/settings/api-keys')
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <Card className="max-w-2xl w-full mx-4">
        <CardHeader>
          <CardTitle>API Key Created</CardTitle>
          <CardDescription>
            Save this key somewhere safe. You won't be able to see it again.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-gray-50 p-4 rounded-lg border">
            <div className="flex items-center justify-between">
              <code className="text-sm font-mono break-all">{newKey}</code>
              <Button
                variant="ghost"
                size="sm"
                onClick={copyToClipboard}
                className="ml-2 flex-shrink-0"
              >
                {copied ? (
                  <CheckCircle className="h-4 w-4 text-green-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <p className="text-sm text-blue-900 font-medium mb-2">Usage:</p>
            <pre className="bg-blue-900 text-blue-100 p-3 rounded text-xs overflow-x-auto">
              export CODE_AUDITOR_API_KEY={newKey}
            </pre>
          </div>

          <div className="flex justify-end">
            <Button onClick={dismiss}>Done</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
