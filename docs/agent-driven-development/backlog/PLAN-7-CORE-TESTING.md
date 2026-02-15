# Implementation Plan: Core Package Testing

**Priority:** 🟢 MEDIUM - Technical debt backfill (new code uses TDD)
**Scope:** packages/core
**Agent Strategy:** Single agent, 3 tasks (can run parallel or sequential)
**Estimated Time:** 8-12 hours
**Branch:** `feature/core-tests`

## Agent Execution

```
Option A (Parallel - if context allows):
  core-001a: Orchestrator tests [2-3h]
  core-001b: Agent parsing tests [4-5h]
  core-001c: Chunking/Discovery tests [2-4h]

Option B (Sequential - if context limited):
  core-001 (spawn new or RESUME from PLAN-8):
    Role: Tester
    Tasks:
      1. Orchestrator tests [2-3h]
      2 (RESUME): Agent parsing tests [4-5h]
      3 (RESUME): Chunking/Discovery tests [2-4h]
```

**Dependencies:** None (can run after Phase 1 or in parallel with PLAN-8)
**Note:** This backfills tests for EXISTING code. All NEW code uses TDD (tests first).

## Overview

Add comprehensive test coverage to the core package (multi-agent orchestration engine). Currently **0% test coverage** for 2000+ lines of critical business logic.

**Current State:**
- packages/core: 0 tests, ~2000 LOC
- No confidence in agent changes
- Manual testing only

**Target State:**
- 80%+ test coverage
- Automated agent validation
- Confidence in refactoring
- Foundation for adding new agents

---

## Test Coverage Gaps

### Critical (No Tests) 🔴
1. **Orchestrator** (`orchestrator.ts` - 143 LOC)
   - Agent parallel execution
   - Error handling (Promise.allSettled)
   - Weighted score calculation
   - Duration tracking

2. **Agents** (`agents/*.ts` - ~800 LOC)
   - Response parsing (JSON extraction)
   - Fallback handling when JSON fails
   - Score validation (0-10 range)
   - Finding structure validation
   - Weight validation (sum to 1.0)

3. **Chunking** (`chunker.ts` - 138 LOC)
   - Token estimation
   - File splitting logic
   - Chunk size limits

4. **Report Generation** (`report/*.ts` - ~500 LOC)
   - Markdown formatting
   - Terminal color codes
   - Report synthesis

### Important (Should Test)
5. **Discovery** (`discovery-node.ts` - 178 LOC)
   - File pattern matching
   - Gitignore parsing
   - Language detection

6. **Client** (`client.ts` - 161 LOC)
   - Claude API calls
   - Error handling
   - Retry logic (if any)

---

## Implementation Waves

### Wave 1: Agent System Tests (4-6h)
**Goal**: Test agent parsing and validation

**What to test:**
1. **Agent response parsing**
   - Valid JSON response → AgentResult
   - Malformed JSON → fallback parsing
   - Missing fields → defaults
   - Invalid score → clamped to 0-10

2. **Weight validation**
   - Sum equals 1.0 → pass
   - Sum != 1.0 → throw error
   - Test with all 5 agents

3. **Finding validation**
   - Severity values (critical/warning/info)
   - Required fields (title, description, file)
   - Optional fields (line, suggestion)

**Test structure:**
```typescript
// packages/core/src/agents/__tests__/parsing.test.ts
describe('Agent Response Parsing', () => {
  describe('Correctness Agent', () => {
    test('parses valid JSON response', () => {
      const response = `{
        "score": 8.5,
        "summary": "Good code quality",
        "findings": [...]
      }`
      const result = correctnessAgent.parseResponse(response)
      expect(result.score).toBe(8.5)
      expect(result.agent).toBe('correctness')
    })

    test('handles malformed JSON with fallback', () => {
      const response = 'Not JSON at all'
      const result = correctnessAgent.parseResponse(response)
      expect(result.score).toBe(0)
      expect(result.findings).toHaveLength(1)
      expect(result.findings[0].severity).toBe('critical')
    })

    test('clamps invalid scores', () => {
      const response = `{"score": 15, "summary": "test", "findings": []}`
      const result = correctnessAgent.parseResponse(response)
      expect(result.score).toBeLessThanOrEqual(10)
    })
  })

  describe('Weight Validation', () => {
    test('all agent weights sum to 1.0', () => {
      const sum = agents.reduce((s, a) => s + a.weight, 0)
      expect(sum).toBeCloseTo(1.0, 4)
    })
  })
})
```

**Files to create:**
- `packages/core/src/agents/__tests__/parsing.test.ts`
- `packages/core/src/agents/__tests__/weights.test.ts`

**Effort**: 4-6 hours

---

### Wave 2: Orchestrator Tests (2-3h)
**Goal**: Test parallel execution and score calculation

**What to test:**
1. **Parallel execution**
   - All agents run in parallel
   - Failed agent doesn't block others
   - Results collected from all agents

2. **Score calculation**
   - Weighted average correct
   - Handles 0 scores
   - Handles missing agents

3. **Error handling**
   - Agent throws error → score 0
   - Agent times out → score 0
   - All agents fail → overall score 0

**Test structure:**
```typescript
// packages/core/src/__tests__/orchestrator.test.ts
describe('Orchestrator', () => {
  test('runs all agents in parallel', async () => {
    const mockFiles = [{ path: 'test.ts', content: '...', ... }]
    const results = await runAudit(mockFiles, { model: 'test' })

    expect(results).toHaveLength(5)
    expect(results.map(r => r.agent)).toContain('correctness')
    expect(results.map(r => r.agent)).toContain('security')
  })

  test('continues when one agent fails', async () => {
    // Mock one agent to fail
    const results = await runAudit(mockFiles, { model: 'test' })

    // Should have 5 results, one with score 0
    expect(results).toHaveLength(5)
    expect(results.some(r => r.score === 0)).toBe(true)
  })

  test('calculates weighted score correctly', () => {
    const results = [
      { agent: 'correctness', score: 8, weight: 0.25 },
      { agent: 'security', score: 6, weight: 0.25 },
      { agent: 'performance', score: 7, weight: 0.15 },
      { agent: 'maintainability', score: 8, weight: 0.20 },
      { agent: 'edge-cases', score: 5, weight: 0.15 }
    ]
    const overall = calculateOverallScore(results)

    // (8*0.25 + 6*0.25 + 7*0.15 + 8*0.20 + 5*0.15) = 6.85
    expect(overall).toBeCloseTo(6.85, 2)
  })
})
```

**Files to create:**
- `packages/core/src/__tests__/orchestrator.test.ts`

**Effort**: 2-3 hours

**Note**: Will need to mock Claude API calls

---

### Wave 3: Chunking & Discovery Tests (2-3h)
**Goal**: Test file handling logic

**What to test:**
1. **Chunking**
   - Files fit in single chunk → 1 chunk
   - Files exceed limit → multiple chunks
   - Never splits individual file
   - Chunk summary formatting

2. **Discovery**
   - Finds all code files
   - Respects gitignore
   - Detects language correctly
   - Filters by size

**Test structure:**
```typescript
// packages/core/src/__tests__/chunker.test.ts
describe('Chunking', () => {
  test('single chunk when under limit', () => {
    const files = [
      { content: 'small file', size: 100, ... }
    ]
    const chunks = createChunks(files, 10000)
    expect(chunks).toHaveLength(1)
  })

  test('multiple chunks when over limit', () => {
    const files = [
      { content: 'x'.repeat(50000), size: 50000, ... },
      { content: 'x'.repeat(50000), size: 50000, ... }
    ]
    const chunks = createChunks(files, 60000)
    expect(chunks.length).toBeGreaterThan(1)
  })

  test('never splits individual file', () => {
    const files = [
      { path: 'big.ts', content: 'x'.repeat(100000), ... }
    ]
    const chunks = createChunks(files, 50000)

    // File too big for chunk, but still in one chunk
    chunks.forEach(chunk => {
      const filesInChunk = chunk.files.filter(f => f.path === 'big.ts')
      expect(filesInChunk.length).toBeLessThanOrEqual(1)
    })
  })
})
```

**Files to create:**
- `packages/core/src/__tests__/chunker.test.ts`
- `packages/core/src/__tests__/discovery.test.ts`

**Effort**: 2-3 hours

---

## Test Infrastructure

### Setup Testing Framework
```bash
cd packages/core

# Add test dependencies
bun add -D vitest @vitest/coverage-v8

# Add test scripts to package.json
{
  "scripts": {
    "test": "vitest",
    "test:coverage": "vitest --coverage",
    "test:ui": "vitest --ui"
  }
}

# Create vitest config
cat > vitest.config.ts <<EOF
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
})
EOF
```

### Mock Claude API
```typescript
// packages/core/src/__tests__/mocks/claude.ts
import { vi } from 'vitest'

export const mockClaudeResponse = (response: string) => {
  vi.mock('../client', () => ({
    callClaude: vi.fn().mockResolvedValue(response)
  }))
}
```

---

## Acceptance Criteria

- [ ] 80%+ test coverage for core package
- [ ] All critical paths tested (orchestrator, agents, chunking)
- [ ] Tests run in CI/CD
- [ ] Coverage report generated
- [ ] Documentation with testing patterns

---

## Benefits

**Quality**:
- Catch bugs before production
- Confidence in agent changes
- Safe to add new agents

**Velocity**:
- Faster development (no manual testing)
- Safe refactoring
- Clear contracts for agent behavior

**Business**:
- More reliable product
- Faster feature development
- Lower support costs

---

## Risks & Mitigations

**Risk**: Mocking Claude API makes tests unrealistic
- **Mitigation**: Add integration tests with real API calls (separate suite)

**Risk**: Tests slow down development
- **Mitigation**: Fast unit tests (<100ms each), slow integration tests optional

**Risk**: High maintenance burden
- **Mitigation**: Focus on critical paths, skip trivial code

---

## Follow-up Work

After this plan:
- Add integration tests with real Claude API
- Add E2E tests for CLI workflows
- Set up coverage gates in CI/CD (require 80%)
- Add property-based testing for chunking logic
