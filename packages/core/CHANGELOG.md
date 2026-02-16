# @code-auditor/core Changelog

## Unreleased

### Added
- **Error classes** - Specific error types for better error handling
  - `RateLimitError` - Thrown when API rate limit is exceeded (includes `retryAfter` seconds)
  - `AuthenticationError` - Thrown on 401 authentication failures (includes help URL)
  - `ValidationError` - Thrown on input validation failures (includes field name)
  - `AgentError` - Thrown when an agent fails during analysis (includes agent name)

- **Progress callbacks** - Real-time progress tracking during audits
  - `ProgressEvent` type with four event types:
    - `started` - Audit begins (includes agent count)
    - `agent-started` - Individual agent starts
    - `agent-completed` - Agent finishes (includes score and duration)
    - `completed` - All agents finish (includes total duration)
  - `runAudit()` now accepts optional `onProgress` callback parameter

### Changed
- `client.ts` now throws specific error classes instead of generic Error
  - 401 responses → `AuthenticationError`
  - 429 responses after retries → `RateLimitError`
  - Missing API key → `ValidationError`

- `orchestrator.ts` updated to emit progress events during execution
  - Optional callback parameter maintains backward compatibility

### Testing
- Added comprehensive test coverage for error classes (100% coverage)
- Added tests for progress event types and callback behavior
- All tests passing with 42 total tests across 6 test files

## Migration Guide

### For CLI users
No breaking changes - new features are opt-in.

### For library consumers
If you were catching generic `Error`, you may want to catch specific error types:

```typescript
import { runAudit, RateLimitError, AuthenticationError } from '@code-auditor/core'

try {
  const results = await runAudit(files, options)
} catch (error) {
  if (error instanceof RateLimitError) {
    console.error(`Rate limited. Retry after ${error.retryAfter}s`)
  } else if (error instanceof AuthenticationError) {
    console.error(`Auth failed. Help: ${error.helpUrl}`)
  }
}
```

To use progress callbacks:

```typescript
const results = await runAudit(files, options, (event) => {
  if (event.type === 'agent-completed') {
    console.log(`${event.agent} completed in ${event.duration}s with score ${event.score}`)
  }
})
```
