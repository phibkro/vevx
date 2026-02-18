// Re-export ValidationError for convenience
export { ValidationError } from './validation'

/**
 * Format errors with helpful, actionable messages
 */
export function formatError(error: Error): string {
  // Check error type and format accordingly
  if (error.name === 'RateLimitError') {
    const retryAfter = (error as any).retryAfter || 60
    return `
✗ Rate Limit Exceeded

  You've hit the API rate limit.

  Solutions:
  • Wait ${retryAfter} seconds and try again
  • Reduce audit scope with .gitignore
  • Upgrade your Anthropic API tier

  Learn more: https://docs.anthropic.com/rate-limits
`
  }

  if (error.name === 'AuthenticationError') {
    const helpUrl = (error as any).helpUrl || 'https://console.anthropic.com/'
    return `
✗ Authentication Failed

  Your API key is invalid or missing.

  Solutions:
  • Check ANTHROPIC_API_KEY environment variable
  • Get a new key: ${helpUrl}
  • Run: export ANTHROPIC_API_KEY=your-key-here
`
  }

  if (error.name === 'ValidationError') {
    return `
✗ Validation Error

  ${error.message || 'Invalid input'}

  Check your input and try again.
`
  }

  // Generic error
  return `
✗ Error

  ${error.message || 'An unknown error occurred'}

  If this persists, please report: https://github.com/yourusername/ai-code-auditor/issues
`
}
