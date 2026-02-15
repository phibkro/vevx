# Implementation Plan: Core Product Polish

**Priority:** 🟡 HIGH - User experience & reliability
**Scope:** packages/core + apps/cli (2 scopes, parallel execution)
**Agent Strategy:** 2 parallel agents, each owns a scope
**Estimated Time:** 6-10h total (3-5h per agent in parallel)
**Branch:** `feature/core-polish`

## Agent Execution

```
Track A - packages/core agent:
  core-001 (spawn new):
    Role: Builder
    Tasks:
      1. Error classes (errors.ts) [1-2h]
      2. Progress callbacks (orchestrator.ts) [1-2h]

  core-001 (RESUME):
    Role: Tester
    Tasks:
      3. Test error handling [1h]

Track B - apps/cli agent (runs in PARALLEL):
  cli-001 (spawn new):
    Role: Builder
    Tasks:
      1. CLI error display [1-2h]
      2. Progress indicators [1-2h]

  cli-001 (RESUME):
    Role: Tester
    Tasks:
      3. Test CLI output [1h]
```

**Dependencies:** PLAN-9 (CI/CD) complete
**Parallel safe:** Yes (different scopes, no shared files)

## Overview

Polish the core product for production readiness: better error messages, input validation, progress indicators, and edge case handling.

**Current State:**
- Basic functionality works
- Cryptic error messages
- No progress indicators for long audits
- Poor handling of edge cases (empty files, large files, no API key)

**Target State:**
- Professional error messages with actionable fixes
- Progress indicators for user feedback
- Graceful handling of all edge cases
- Production-ready reliability

---

## Polish Areas

### 1. Error Messages & Handling (2-3h)
**Current problems:**
- Generic errors: "Agent failed"
- No guidance on fixing issues
- Stack traces shown to users
- Silent failures

**Target behavior:**
```bash
# Current
✗ Error: Agent correctness failed

# Improved
✗ Analysis failed: Claude API rate limit exceeded

  You've hit the rate limit for your API tier.

  Solutions:
  • Wait 60 seconds and try again
  • Reduce codebase size with .gitignore
  • Upgrade your Anthropic API tier

  Learn more: https://docs.anthropic.com/rate-limits
```

**Implementation:**
1. **Categorize errors**
   - API errors (rate limit, auth, timeout)
   - Input errors (no files, invalid path)
   - Agent errors (parsing failed, timeout)
   - System errors (out of memory, disk full)

2. **Add error classes**
```typescript
// packages/core/src/errors.ts
export class RateLimitError extends Error {
  constructor(retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
  }
}

export class AuthenticationError extends Error {
  constructor() {
    super('Invalid API key')
    this.name = 'AuthenticationError'
    this.helpUrl = 'https://docs.anthropic.com/authentication'
  }
}
```

3. **Update CLI error display**
```typescript
// apps/cli/src/cli.ts
catch (error) {
  if (error instanceof RateLimitError) {
    console.error(`\n✗ Rate Limit Exceeded\n`)
    console.error(`  Wait ${error.retryAfter}s and try again.`)
    console.error(`  Or reduce audit scope with .gitignore\n`)
    process.exit(1)
  } else if (error instanceof AuthenticationError) {
    console.error(`\n✗ Authentication Failed\n`)
    console.error(`  Your API key is invalid or expired.`)
    console.error(`  Get a new key: ${error.helpUrl}\n`)
    process.exit(1)
  }
  // ... other error types
}
```

**Files to change:**
- Create `packages/core/src/errors.ts`
- Update `packages/core/src/client.ts` - Throw specific errors
- Update `packages/core/src/orchestrator.ts` - Catch and wrap errors
- Update `apps/cli/src/cli.ts` - Display helpful messages

**Effort**: 2-3 hours

---

### 2. Progress Indicators (1-2h)
**Current problems:**
- No feedback during long audits (10s-60s)
- User doesn't know if it's working
- Looks frozen on large codebases

**Target behavior:**
```bash
code-audit src/

Discovering files... ✓ Found 47 files (234 KB)
Creating chunks... ✓ 1 chunk (within token limit)

Running analysis...
  ✓ Correctness     [2.3s]
  ✓ Security        [2.1s]
  ⏳ Performance    ...
  ⏳ Maintainability ...
  ⏳ Edge Cases     ...

All agents completed in 3.8s
```

**Implementation:**
1. **Add progress tracking**
```typescript
// packages/core/src/orchestrator.ts
export async function runAudit(
  files: FileContent[],
  options: OrchestratorOptions,
  onProgress?: (event: ProgressEvent) => void
): Promise<AgentResult[]> {

  onProgress?.({ type: 'started', agentCount: agents.length })

  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      onProgress?.({ type: 'agent-started', agent: agent.name })
      const result = await runAgent(agent, files, options)
      onProgress?.({ type: 'agent-completed', agent: agent.name, score: result.score })
      return result
    })
  )

  onProgress?.({ type: 'completed' })
  return results
}
```

2. **Update CLI to show progress**
```typescript
// apps/cli/src/cli.ts
const results = await runAudit(files, options, (event) => {
  if (event.type === 'agent-completed') {
    console.log(`  ✓ ${event.agent.padEnd(15)} [${event.duration}s]`)
  }
})
```

**Files to change:**
- Update `packages/core/src/orchestrator.ts` - Add progress callback
- Update `packages/types/src/index.ts` - Add ProgressEvent type
- Update `apps/cli/src/cli.ts` - Display progress

**Effort**: 1-2 hours

---

### 3. Input Validation (1-2h)
**Current problems:**
- No validation of API key format
- Doesn't check file readability
- Allows invalid model names
- Poor handling of empty directories

**Target behavior:**
```bash
# Invalid API key format
✗ Invalid API key format

  API keys should start with 'sk-ant-'
  Example: sk-ant-api03-abc123...

  Get your key: https://console.anthropic.com

# No files found
✗ No code files found in src/

  Checked: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++

  Tips:
  • Check the path is correct
  • Ensure files have code extensions (.ts, .js, .py, etc.)
  • Check .gitignore isn't excluding everything
```

**Implementation:**
1. **Validate API key**
```typescript
// packages/core/src/client.ts
export function validateApiKey(key: string): void {
  if (!key) {
    throw new AuthenticationError('API key not provided')
  }
  if (!key.startsWith('sk-ant-')) {
    throw new AuthenticationError('Invalid API key format')
  }
  if (key.length < 20) {
    throw new AuthenticationError('API key too short')
  }
}
```

2. **Validate input files**
```typescript
// packages/core/src/discovery-node.ts
export async function discoverFiles(path: string): Promise<FileContent[]> {
  if (!existsSync(path)) {
    throw new FileNotFoundError(path)
  }

  const files = await findCodeFiles(path)

  if (files.length === 0) {
    throw new NoFilesFoundError(path, supportedExtensions)
  }

  return files
}
```

3. **Validate model name**
```typescript
// packages/core/src/client.ts
const VALID_MODELS = [
  'claude-opus-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-haiku-4-5-20251001'
]

export function validateModel(model: string): void {
  if (!VALID_MODELS.includes(model)) {
    throw new InvalidModelError(model, VALID_MODELS)
  }
}
```

**Files to change:**
- Update `packages/core/src/errors.ts` - Add validation error classes
- Update `packages/core/src/client.ts` - Add validateApiKey, validateModel
- Update `packages/core/src/discovery-node.ts` - Add NoFilesFoundError
- Update `apps/cli/src/cli.ts` - Call validation early

**Effort**: 1-2 hours

---

### 4. Edge Case Handling (2-3h)
**Current problems:**
- Crashes on very large files (>10MB)
- Hangs on binary files
- Doesn't handle permission errors
- No handling of .gitignore syntax errors

**Target behavior:**
- Skip files >5MB with warning
- Detect and skip binary files
- Graceful permission errors
- Continue on .gitignore parse errors

**Implementation:**
1. **File size limits**
```typescript
// packages/core/src/discovery-node.ts
const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB

async function loadFile(path: string): Promise<FileContent | null> {
  const stats = await stat(path)

  if (stats.size > MAX_FILE_SIZE) {
    console.warn(`⚠️  Skipping ${path} (${formatSize(stats.size)}, limit: 5MB)`)
    return null
  }

  // ... rest of loading
}
```

2. **Binary file detection**
```typescript
function isBinary(buffer: Buffer): boolean {
  // Check for null bytes (binary indicator)
  for (let i = 0; i < Math.min(buffer.length, 8000); i++) {
    if (buffer[i] === 0) return true
  }
  return false
}

async function loadFile(path: string): Promise<FileContent | null> {
  const buffer = await readFile(path)

  if (isBinary(buffer)) {
    console.warn(`⚠️  Skipping ${path} (binary file)`)
    return null
  }

  return {
    content: buffer.toString('utf-8'),
    // ...
  }
}
```

3. **Permission handling**
```typescript
async function loadFile(path: string): Promise<FileContent | null> {
  try {
    const content = await readFile(path, 'utf-8')
    return { content, path, ... }
  } catch (err) {
    if (err.code === 'EACCES') {
      console.warn(`⚠️  Permission denied: ${path}`)
      return null
    }
    throw err
  }
}
```

**Files to change:**
- Update `packages/core/src/discovery-node.ts` - Add size/binary checks
- Update `packages/core/src/discovery.ts` - Same for Bun version
- Add `packages/core/src/utils/format.ts` - Helper functions

**Effort**: 2-3 hours

---

## Implementation Waves

### Wave 1: Error Messages (2-3h)
**Priority**: 🔴 Critical - Users need to understand failures

1. Create error classes
2. Update client to throw specific errors
3. Update CLI to display helpful messages
4. Test with various error scenarios

**Impact**: High - Every user sees better error messages

---

### Wave 2: Progress Indicators (1-2h)
**Priority**: 🟡 High - Improves perceived performance

1. Add progress callback to orchestrator
2. Update CLI to show agent progress
3. Test with small and large codebases

**Impact**: Medium - Reduces perceived wait time

---

### Wave 3: Input Validation (1-2h)
**Priority**: 🟡 High - Prevents user frustration

1. Validate API key format
2. Validate model names
3. Check files exist before processing
4. Test with invalid inputs

**Impact**: Medium - Catches problems early

---

### Wave 4: Edge Cases (2-3h)
**Priority**: 🟢 Medium - Improves reliability

1. Add file size limits
2. Skip binary files
3. Handle permission errors
4. Test with edge cases

**Impact**: Low - Most users won't hit these, but better when they do

---

## Acceptance Criteria

- [ ] All error messages are actionable
- [ ] Progress shown for long-running audits
- [ ] Invalid inputs caught early with helpful messages
- [ ] Graceful handling of edge cases (large files, binaries, permissions)
- [ ] No crashes on valid inputs
- [ ] Documentation updated with error handling

---

## Benefits

**User Experience**:
- Clear feedback on what went wrong
- Know when something's working vs stuck
- Confidence in the tool

**Support**:
- Fewer "it's broken" tickets
- Self-service error resolution
- Better bug reports

**Business**:
- Professional product feel
- Lower support costs
- Better reviews/word-of-mouth

---

## Metrics

**Before**:
- Generic errors: "Agent failed"
- No progress feedback
- Crashes on edge cases

**After**:
- Specific error messages with solutions
- Real-time progress indicators
- Graceful handling of all inputs

---

## Follow-up Work

After this plan:
- Add retry logic for transient failures
- Add caching to avoid re-analyzing unchanged files
- Add configuration validation (.code-audit.json schema)
- Add telemetry for error tracking (with user consent)
