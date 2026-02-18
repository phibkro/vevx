/**
 * Error thrown when API rate limit is exceeded
 */
export class RateLimitError extends Error {
  retryAfter: number

  constructor(retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

/**
 * Error thrown when API authentication fails
 */
export class AuthenticationError extends Error {
  helpUrl: string

  constructor() {
    super('Invalid or missing API key')
    this.name = 'AuthenticationError'
    this.helpUrl = 'https://docs.anthropic.com/en/api/getting-started'
  }
}

/**
 * Error thrown when input validation fails
 */
export class ValidationError extends Error {
  field: string

  constructor(field: string, message: string) {
    super(`${field}: ${message}`)
    this.name = 'ValidationError'
    this.field = field
  }
}

/**
 * Error thrown when an agent fails during analysis
 */
export class AgentError extends Error {
  agentName: string

  constructor(agentName: string, message: string) {
    super(`Agent ${agentName} failed: ${message}`)
    this.name = 'AgentError'
    this.agentName = agentName
  }
}
