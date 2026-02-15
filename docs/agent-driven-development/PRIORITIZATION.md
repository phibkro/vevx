# Agent Orchestration Plan

**Development Model**: Agent Driven Development (ADD)
**Team**: AI agents orchestrated by Claude
**Workflow**: Plan → Route → Execute → Verify
**Coordination**: Dependency graph + CI/CD feedback

## Orchestration Principles

1. **Agents by Scope** - Agents specialize by codebase area (apps/web, apps/cli, packages/core), not by role
2. **Resume with Role Injection** - Same agent, different roles (Builder → Tester → Reviewer) via prompt
3. **Context Reuse** - Agents retain knowledge of their scope across tasks
4. **Parallel Execution** - Independent scopes run simultaneously
5. **CI/CD as Coordinator** - Automated quality gates provide feedback

## Priority System: Dependency Graph

**No priority formula** - Use dependency graph + value ranking instead:

```
1. Topological Sort (dependency graph)
   └─ Ensures prerequisites complete first
   └─ Hard constraint: never violate dependencies

2. Value Ranking (within each level)
   └─ Breaks ties when multiple tasks ready
   └─ Business value still matters to PM

3. Parallel Scheduling (maximize concurrency)
   └─ Run independent tasks simultaneously
   └─ Free speedup for agents
```

**Why this works for AI agents:**
- **Dependencies matter** - Blocked work wastes context
- **Effort is cheap** - Agents don't get tired, work 24/7
- **Risk is managed** - CI/CD catches issues, retry is easy
- **Parallelization is free** - No coordination overhead like humans

---

## Phase 1: Foundation (MUST DO FIRST) 🔴

**Goal**: Establish automated quality gates and reliable test suite

**Dependency**: Sequential execution (PLAN-6 blocks PLAN-9, which blocks everything else)

### PLAN-6: Fix Failing Tests
**Scope**: apps/web
**Agent**: web-001 (spawn new)
**Effort**: 4-6h
**Value**: 10 (Blocks CI/CD)
**Risk**: 10 (Critical blocker)
**Priority**: 🔴 CRITICAL (blocks all other work)

**Why First:**
- Can't implement CI/CD with failing tests
- All other work depends on reliable test suite

**Agent Execution:**
```
web-001 (Builder role):
  Task 1: Fix mock database (6 tests) [2h]
  Task 2: Fix rate limiting (5 tests) [1h]
  Task 3: Fix webhook signatures (3 tests) [1-2h]

web-001 (Tester role, RESUME):
  Task 4: Verify all 45 tests pass
  Task 5: Check for flaky tests
```

**Acceptance Criteria:**
- [ ] All 45 tests passing
- [ ] No flaky tests (<30s runtime)
- [ ] CI-ready test suite

---

### PLAN-9: CI/CD Infrastructure
**Scope**: Root + apps/web
**Agent**: web-001 (RESUME from PLAN-6)
**Effort**: 6-8h
**Value**: 10 (Enables fast iteration)
**Risk**: 8 (Foundation)
**Priority**: 🔴 CRITICAL (blocks all other work)

**Depends on**: PLAN-6 complete

**Why Second:**
- Enables TDD workflow
- Fast feedback loops (<5min)
- Blocks productive development

**Agent Execution:**
```
web-001 (DevOps role, RESUME):
  Task 1: GitHub Actions workflow [3h]
  Task 2: Quality gates (tests, lint, coverage ≥80%) [2h]
  Task 3: Branch protection rules [1h]

web-001 (Tester role, RESUME):
  Task 4: Verify CI pipeline works [1-2h]
  Task 5: Test auto-deploy to staging
```

**Acceptance Criteria:**
- [ ] Tests run on every PR
- [ ] Can't merge without passing tests
- [ ] Auto-deploy to staging works
- [ ] <5min feedback time

**Phase 1 Result:**
✅ Reliable test suite
✅ Automated CI/CD
✅ Can start parallel development

---

## Phase 2: Core Quality (Parallel Execution) 🟡

**Goal**: Polish core product with TDD workflow

**Dependency**: Requires Phase 1 complete (CI/CD foundation)

**Execution**: 2 parallel agents in different scopes

### PLAN-8: Core Product Polish
**Effort**: 6-10h total (3-5h per agent in parallel)
**Value**: 9 (UX, reduces support)
**Risk**: 2 (Independent work)
**Priority**: 🟡 HIGH (parallel with PLAN-7, good UX ROI)

**Why Third:**
- Improves UX dramatically
- Parallel execution possible
- TDD workflow demonstration

#### Track A: packages/core Agent

**Agent**: core-001 (spawn new)
**Scope**: packages/core

**Tasks (Builder role):**
1. Error classes (error.ts) [1-2h]
   - TDD: Write tests for each error type first
   - Implement: RateLimitError, AuthError, ValidationError, etc.
   - Tests verify error messages are actionable

2. Progress callbacks (orchestrator.ts) [1-2h]
   - TDD: Write test for ProgressEvent emissions
   - Implement: onProgress callback in runAudit()
   - Tests verify events emitted at correct times

**Tasks (Tester role, RESUME core-001):**
3. Test error handling [1h]
   - Verify error messages meet acceptance criteria
   - Coverage ≥80% on new code

**Acceptance Criteria:**
- [ ] All errors show what went wrong + how to fix
- [ ] Progress events emitted during audit
- [ ] Tests written first (TDD)
- [ ] Coverage ≥80%

#### Track B: apps/cli Agent

**Agent**: cli-001 (spawn new, runs in parallel with core-001)
**Scope**: apps/cli

**Tasks (Builder role):**
1. CLI error display [1-2h]
   - TDD: Write tests for error formatting
   - Implement: Pretty error messages in CLI
   - Use error classes from packages/core

2. Progress indicators [1-2h]
   - TDD: Write tests for progress UI
   - Implement: Spinner + status for each agent
   - Visual feedback during analysis

**Tasks (Tester role, RESUME cli-001):**
3. Test CLI output [1h]
   - Verify progress indicators work
   - Test edge cases (large files, binaries)

**Acceptance Criteria:**
- [ ] CLI shows actionable errors
- [ ] Progress visible during analysis
- [ ] Input validation with helpful messages
- [ ] Coverage ≥80%

**Parallel Execution:**
```
core-001 (packages/core)  ||  cli-001 (apps/cli)
    ├─ Error classes      ||      ├─ Error display
    ├─ Progress callbacks ||      ├─ Progress UI
    └─ Tests              ||      └─ Tests
```

**Total time**: 3-5h (parallel) vs 6-10h (sequential)

---

## Phase 3: Testing Backfill (Technical Debt) 🟢

**Goal**: Add tests to existing core package code

**Dependency**: None (can start after Phase 1)

**Execution**: Single agent, 3 parallel tasks

### PLAN-7: Core Package Testing (Backfill Existing Code)
**Scope**: packages/core
**Agent**: core-001 (RESUME from PLAN-8 if available, or spawn new)
**Effort**: 8-12h total (2-4h per task in parallel)
**Value**: 7 (Confidence, refactoring ability)
**Risk**: 3 (Can be done incrementally)
**Priority**: 🟢 MEDIUM (technical debt, can run in parallel with PLAN-8)

**Note:** This backfills tests for EXISTING code. New code uses TDD (tests first).

**Agent Execution (Tester role):**

Can run as 3 parallel tasks or sequential, depending on context window:

```
Option A (Parallel - if context allows):
  core-001a: Orchestrator tests [2-3h]
  core-001b: Agent parsing tests [4-5h]
  core-001c: Chunking/Discovery tests [2-4h]

Option B (Sequential - if context limited):
  core-001 (Tester role):
    Task 1: Orchestrator tests [2-3h]
    Task 2 (RESUME): Agent parsing [4-5h]
    Task 3 (RESUME): Chunking/Discovery [2-4h]
```

#### Task 1: Orchestrator Tests
**Files**: `packages/core/src/orchestrator.ts`, `packages/core/src/__tests__/orchestrator.test.ts`

**What to test:**
- [ ] Parallel execution (Promise.allSettled)
- [ ] Error handling (one agent fails, others continue)
- [ ] Weighted score calculation
- [ ] Duration tracking

**Coverage target**: ≥80%

#### Task 2: Agent Parsing Tests
**Files**: `packages/core/src/agents/*.ts`, `packages/core/src/agents/__tests__/parsing.test.ts`

**What to test:**
- [ ] All 5 agents (correctness, security, performance, maintainability, edge-cases)
- [ ] JSON parsing from Claude response
- [ ] Fallback handling (malformed JSON)
- [ ] Score validation (0-10 range)
- [ ] Weight validation (sum to 1.0)

**Coverage target**: ≥80%

#### Task 3: Chunking & Discovery Tests
**Files**: `packages/core/src/chunker.ts`, `packages/core/src/discovery*.ts`

**What to test:**
- [ ] Chunking logic (token limits, file splitting)
- [ ] File discovery (glob patterns, gitignore)
- [ ] Language detection
- [ ] Edge cases (large files, binary files)

**Coverage target**: ≥80%

**Acceptance Criteria:**
- [ ] 80%+ coverage on packages/core
- [ ] All critical paths tested
- [ ] Can refactor safely

---

## Backlog (Lower Priority)

Listed in priority order for future execution:

1. **PLAN-3: Positioning & Pricing** (Effort: 13h, Value: High)
   - Fix backwards pricing model
   - Product must work first

2. **PLAN-2: DX Improvements** (Effort: 21h, Value: Medium)
   - Installation script, license system, auth flow
   - Requires stable foundation

3. **PLAN-4: Marketing & GTM** (Effort: 21h, Value: High)
   - Needs polished product + pricing
   - Can't market broken product

4. **PLAN-5: Brand Identity** (Effort: Unknown, Value: Low)
   - Nice to have, not required
   - Product quality more important

---

## Execution Priority (Dependency Graph)

```
Phase 1 (Sequential):
  PLAN-6 (Fix Tests) → PLAN-9 (CI/CD)
                           ↓
                      [Foundation Ready]
                           ↓
    ┌──────────────────────┴──────────────────────┐
    │                                              │
Phase 2 (Parallel):                         Phase 3:
  PLAN-8 (Core Polish)                        PLAN-7 (Testing Backfill)
    ├─ core-001 (packages/core)                  └─ core-001 (packages/core)
    └─ cli-001 (apps/cli)                           [Can run in parallel with Phase 2
                                                     or after, depending on context]
    ↓
[Product Ready]
    ↓
Phase 4+ (Business Features):
  PLAN-3 → PLAN-2 → PLAN-4 → PLAN-5
```

---

## Execution Timeline

**Phase 1: Foundation** (10-14h, Sequential)
- PLAN-6: Fix Tests (4-6h) - apps/web agent
- PLAN-9: CI/CD (6-8h) - RESUME apps/web agent
- **Outcome**: Reliable test suite + CI/CD pipeline

**Phase 2: Core Quality** (3-5h in parallel, 6-10h sequential)
- PLAN-8: Core Polish - 2 parallel agents (packages/core + apps/cli)
- **Outcome**: Professional UX, TDD workflow established

**Phase 3: Technical Debt** (8-12h, can overlap with Phase 2)
- PLAN-7: Testing Backfill - packages/core agent
- **Outcome**: 80%+ coverage, confident refactoring

**Phase 4+: Business Features**
- Pricing, DX, Marketing, Brand
- **Outcome**: Ready for growth

**Total time to production-ready**: ~21-31 agent hours

---

## Orchestration Strategy

### Agent Spawning Rules

```typescript
function routeTask(plan: Plan) {
  const scope = identifyScope(plan) // apps/web, apps/cli, packages/core

  // Check for existing agent in scope
  const existingAgent = agents.find(a => a.scope === scope)

  if (existingAgent && existingAgent.contextUsage < 0.8) {
    // RESUME with new role
    return Task({
      resume: existingAgent.id,
      prompt: `${role} role: ${plan.description}`,
    })
  } else {
    // SPAWN new agent
    return Task({
      prompt: `${role} role for ${scope}: ${plan.description}`,
    })
  }
}
```

### Parallel Execution Rules

**Run in parallel when:**
- Different scopes (web ≠ cli ≠ core)
- No shared files/data
- Independent acceptance criteria
- Context window allows (<80% usage per agent)

**Run sequentially when:**
- Same scope (context reuse valuable)
- Dependencies between tasks
- Context window limited (>80% usage)
- Complex changes (>500 LOC or 6+ files)

---

## Success Metrics

### Phase 1 (Foundation)
- [ ] All 45 tests pass
- [ ] CI runs on every PR
- [ ] <5min feedback time
- [ ] Auto-deploy to staging works

### Phase 2 (Quality)
- [ ] 80%+ coverage on new code
- [ ] All errors actionable
- [ ] Progress visible during analysis
- [ ] Input validation catches issues early

### Phase 3 (Technical Debt)
- [ ] 80%+ coverage on packages/core
- [ ] Safe refactoring enabled
- [ ] All critical paths tested

### Phase 4+ (Business)
- [ ] Deployment frequency: multiple/day
- [ ] Change failure rate: <5%
- [ ] MTTR: <15min
- [ ] Revenue goals met

---

## Agent Workflow Checklist

After each task completion, agents MUST:

1. **Verify** via CI/CD
   - [ ] All tests pass
   - [ ] Coverage ≥80%
   - [ ] Lint passes
   - [ ] Build succeeds

2. **Document** changes
   - [ ] Update CLAUDE.md if architecture changed
   - [ ] Update README.md if user-facing changed
   - [ ] Update relevant docs/ if behavior changed
   - [ ] Update PLAN-*.md status

3. **Report** status
   - [ ] Commit with conventional format
   - [ ] Update task status (if tracked)
   - [ ] Note context usage for orchestrator

4. **Context cleanup** (if >80% usage)
   - [ ] Summarize learnings
   - [ ] Store in MEMORY.md if needed
   - [ ] Signal orchestrator for new spawn
