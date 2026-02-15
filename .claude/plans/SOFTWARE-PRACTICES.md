# Software Development Practices

Comprehensive guide to development practices for AI Code Auditor.

**Team**: AI agents orchestrated by Claude
**Workflow**: Plan → Route → Execute → Verify

## Core Practices (AI Agent Team)

### ✅ Agent Orchestration
- **Scope-based agents**: apps/web, apps/cli, packages/core
- **Role injection**: Same agent, different roles (Builder → Tester → Reviewer)
- **Context reuse**: Agents resume with full context
- **Parallel execution**: Independent scopes run simultaneously
- **Dependency graph**: Orchestrator manages task routing

### ✅ Test-Driven Development (TDD)
- Red-Green-Refactor cycle for all NEW code
- Write tests before code
- 80% minimum coverage
- Fast unit tests (<100ms each)
- Backfill tests for existing code separately

### ✅ CI/CD (Automated Coordination)
- Automated testing on every commit
- Quality gates before merge (tests, lint, coverage ≥80%, security)
- Automated deployment to staging
- Fast feedback loops (<5min)
- **Agent feedback mechanism**: CI/CD tells agents pass/fail

---

## Recommended Additional Practices

### 1. Agent Collaboration & Review

#### **Multi-Agent Review** (When needed)
**When to use:**
- Complex features (>500 LOC or 6+ files)
- Architectural decisions
- Security-critical changes
- Performance optimization

**Pattern:**
```
Builder agent completes feature
  ↓
Spawn 2-3 parallel Reviewer agents with different priorities:
  ├─ Security reviewer (focus: vulnerabilities, secrets, injection)
  ├─ Performance reviewer (focus: N+1 queries, caching, optimization)
  └─ Quality reviewer (focus: code smells, maintainability, tests)
  ↓
Orchestrator synthesizes feedback
  ↓
Builder agent addresses issues
```

**Benefits:**
- Multiple expert perspectives
- Parallel review (faster)
- Comprehensive coverage
- No reviewer fatigue

---

#### **Automated Code Quality Gates**
**Enforced by CI/CD** (No manual review needed for these):

```yaml
# .github/workflows/ci.yml
quality_gates:
  - All tests pass
  - Coverage ≥80%
  - Lint passes (no errors)
  - Type check passes
  - No critical security issues (Trivy)
  - Build succeeds
  - Max PR size: 400 lines (split larger)
```

**Human PM Review** (Only for strategic decisions):
- Architecture changes
- Breaking API changes
- Pricing model changes
- User-facing copy changes

---

#### **Agent Post-Task Checklist**
**After EVERY task, agents MUST:**

1. **Verify** via CI/CD
   - [ ] All tests pass
   - [ ] Coverage ≥80%
   - [ ] Lint passes
   - [ ] Build succeeds

2. **Document** changes ⚠️ **MANDATORY** ⚠️
   - [ ] Check if documentation needs updates (ALWAYS)
   - [ ] Update CLAUDE.md if architecture/patterns changed
   - [ ] Update README.md if user-facing features changed
   - [ ] Update relevant docs/ if behavior/APIs changed
   - [ ] Update PLAN-*.md task status
   - [ ] Add/update code comments for complex logic

3. **Report** status
   - [ ] Commit with conventional format
   - [ ] Note context usage (for orchestrator)
   - [ ] Flag blockers if any

4. **Context management**
   - [ ] Summarize learnings if context >80%
   - [ ] Store patterns in MEMORY.md if reusable

---

### 2. Branching Strategy

#### **Trunk-Based Development** (Recommended for CI/CD)

**Strategy:**
```
main (always deployable)
  ↓
feature/short-lived-branch (1-2 days max)
  ↓
main (merge via PR + squash)
```

**Rules:**
- Small, frequent merges
- Feature flags for incomplete work
- No long-lived branches
- Always merge-ready main

**Alternative: GitHub Flow** (simpler)
```
main → feature-branch → PR → main
```

**NOT recommended: GitFlow** (too complex for CI/CD)

---

### 3. Feature Flags

**Why:** Deploy incomplete features without exposing to users

**Implementation:**
```typescript
// lib/feature-flags.ts
export const features = {
  newAgent: process.env.FEATURE_NEW_AGENT === 'true',
  advancedReporting: process.env.FEATURE_ADVANCED_REPORTING === 'true',
}

// Usage
if (features.newAgent) {
  results.push(await namingAgent.analyze(files))
}
```

**Tools:**
- LaunchDarkly (SaaS, $$$)
- Flagsmith (open source)
- PostHog (includes analytics)
- Simple env vars (free, basic)

**Benefits:**
- Deploy anytime
- Test in production
- Gradual rollouts
- Quick rollbacks

---

### 4. Monitoring & Observability

#### **Error Tracking**
**Tool: Sentry**

```typescript
// Setup
import * as Sentry from "@sentry/node"

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
})

// Usage
try {
  await runAudit(files)
} catch (error) {
  Sentry.captureException(error, {
    tags: { agent: 'orchestrator' },
    extra: { fileCount: files.length }
  })
  throw error
}
```

**Benefits:**
- Catch errors before users report
- Stack traces with context
- Performance monitoring
- Release tracking

---

#### **Application Monitoring**
**Options:**
- **Vercel Analytics** (free, basic)
- **DataDog** (comprehensive, $$$)
- **New Relic** (APM focus)
- **Highlight.io** (session replay + monitoring)

**What to track:**
- API response times
- Error rates
- User sessions
- Database query performance
- Claude API latency

---

#### **Logging**
**Structured logging:**
```typescript
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info'
})

logger.info({
  event: 'audit_started',
  fileCount: files.length,
  model: options.model
}, 'Starting audit')

logger.error({
  event: 'agent_failed',
  agent: 'correctness',
  error: err.message
}, 'Agent execution failed')
```

**Log levels:**
- ERROR: Things broke
- WARN: Things might break
- INFO: Things happened
- DEBUG: Why things happened

---

### 5. Security Practices

#### **Dependency Scanning**
**Tools:**
- Dependabot (GitHub, free)
- Snyk (comprehensive)
- Trivy (containers + deps)

**Configuration:**
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    reviewers:
      - "engineering-team"
    labels:
      - "dependencies"
```

---

#### **Secret Scanning**
**Tools:**
- GitGuardian (SaaS)
- TruffleHog (open source)
- GitHub secret scanning (free for private repos)

**Prevention:**
```bash
# Pre-commit hook
# .git/hooks/pre-commit
#!/bin/bash
if git diff --cached | grep -E 'sk-ant-|sk_live_|AKIA'; then
  echo "❌ Potential secret detected!"
  exit 1
fi
```

---

#### **Security Headers**
```typescript
// apps/web/middleware.ts
export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')

  return response
}
```

---

### 6. Release Management

#### **Semantic Versioning**
```
MAJOR.MINOR.PATCH
  1  .  2  .  3

MAJOR: Breaking changes
MINOR: New features (backward compatible)
PATCH: Bug fixes
```

**Examples:**
- `1.0.0` → `1.0.1` (bug fix)
- `1.0.1` → `1.1.0` (new agent added)
- `1.1.0` → `2.0.0` (changed API contract)

---

#### **Changelog Automation**
**Tool: Release Please** (GitHub Action)

```yaml
# .github/workflows/release.yml
name: Release
on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: google-github-actions/release-please-action@v3
        with:
          release-type: node
          package-name: ai-code-auditor
```

**Auto-generates:**
- CHANGELOG.md
- GitHub releases
- Version bumps
- Git tags

---

#### **Hotfix Process**
```bash
# Critical bug in production
git checkout main
git pull
git checkout -b hotfix/critical-bug

# Fix, test, commit
bun run build
bun run test
git commit -m "fix: critical bug in agent parsing"

# Fast-track PR
gh pr create --title "HOTFIX: Critical bug" --label "hotfix"
# Get review ASAP
# Merge and auto-deploy

# Tag release
git tag v1.2.1
git push --tags
```

---

### 7. Documentation Practices

#### **Documentation as Code**
- Docs live with code
- Updated in same PR
- Versioned with releases
- Automatically deployed

**Structure:**
```
docs/
├── architecture/       # Technical design
├── guides/            # How-to guides
├── api/               # API reference
└── changelog/         # Release notes
```

---

#### **ADR (Architecture Decision Records)**
**When to write:**
- Choosing technologies
- Changing architecture
- Complex trade-offs

**Format:**
```markdown
# ADR-001: Use Turborepo for Monorepo

## Status
Accepted

## Context
Need to manage multiple packages (CLI, web, action) with shared code.

## Decision
Use Turborepo for monorepo management.

## Consequences
**Positive:**
- Fast builds with caching
- Shared code without npm publishing
- Better developer experience

**Negative:**
- Learning curve
- Build complexity

## Alternatives Considered
- Lerna
- Nx
- Yarn workspaces
```

---

### 8. Performance Practices

#### **Performance Budgets**
```javascript
// performance.config.js
module.exports = {
  budgets: [
    {
      resourceType: 'script',
      budget: 300 // KB
    },
    {
      resourceType: 'total',
      budget: 1000 // KB
    },
    {
      metric: 'interactive',
      budget: 3000 // ms
    }
  ]
}
```

**Tools:**
- Lighthouse CI
- Bundle analyzer
- web-vitals

---

#### **Database Query Optimization**
```typescript
// ❌ Bad: N+1 query
const audits = await db.audit.findMany()
for (const audit of audits) {
  const findings = await db.finding.findMany({
    where: { auditId: audit.id }
  })
}

// ✅ Good: Single query with include
const audits = await db.audit.findMany({
  include: { findings: true }
})
```

---

### 9. Developer Experience (DX)

#### **Fast Feedback Loops**
```
Change code → See result

Local dev:     <1s  (hot reload)
Unit tests:    <2s  (watch mode)
Build:         <10s (Turbo cache)
Deploy preview: <2min (Vercel)
```

#### **Automation**
```bash
# .husky/pre-commit
bun run lint:fix
bun run format
bun run test:changed

# .husky/pre-push
bun run build
bun run test
```

#### **Scripts for Common Tasks**
```json
// package.json
{
  "scripts": {
    "dev": "turbo dev",
    "test:watch": "turbo test -- --watch",
    "format": "prettier --write .",
    "lint:fix": "turbo lint -- --fix",
    "clean": "turbo clean && rm -rf node_modules",
    "reset": "bun run clean && bun install && bun run build"
  }
}
```

---

## Practice Adoption Roadmap

### Phase 1: Foundation (10-14h)
- ✅ CI/CD pipeline (PLAN-9)
- ✅ Fix failing tests (PLAN-6)
- ✅ Automated quality gates
- ✅ Branching strategy (trunk-based)

### Phase 2: Quality (3-5h parallel)
- ✅ Error tracking (Sentry)
- ✅ Security scanning (Trivy + Dependabot)
- ✅ TDD workflow (established via PLAN-8)
- ✅ Coverage gates (≥80%)

### Phase 3: Technical Debt (8-12h)
- ✅ Testing backfill (PLAN-7)
- ✅ Overall coverage ≥80%
- ✅ Safe refactoring enabled

### Phase 4+: Optimization (As needed)
- ✅ Feature flags (simple env vars → LaunchDarkly)
- ✅ Advanced monitoring (DataDog/New Relic)
- ✅ Release automation (Release Please)
- ✅ Performance budgets (Lighthouse CI)

---

## Metrics Dashboard

### Development Metrics (DORA)
- **Cycle Time**: Task assigned → Merged (<1 day for agents)
- **Deployment Frequency**: Multiple per day (via CI/CD)
- **Lead Time**: Plan created → Production (<2 days)
- **Change Failure Rate**: <5%
- **Mean Time to Recovery**: <15 minutes

### Quality Metrics
- **Test Coverage**: ≥80% (enforced by CI)
- **Agent Success Rate**: Tasks completed without retry (target: >90%)
- **Bug Escape Rate**: <2%
- **Technical Debt**: Tracked in backlog, trending down

### Agent Metrics
- **Context Reuse**: % of tasks that resume agents (target: >50%)
- **Parallel Efficiency**: Tasks run in parallel vs sequential
- **Average Task Time**: Track by scope (web/cli/core)
- **Retry Rate**: % of tasks requiring retry (target: <10%)

---

## Tools Summary

| Practice | Tool | Cost | Priority |
|----------|------|------|----------|
| CI/CD | GitHub Actions | Free | 🔴 Critical |
| Testing | Vitest + Playwright | Free | 🔴 Critical |
| Code Review | GitHub | Free | 🔴 Critical |
| Error Tracking | Sentry | $26/mo | 🟡 High |
| Monitoring | Vercel Analytics | Free | 🟡 High |
| Security Scan | Trivy + Dependabot | Free | 🟡 High |
| Feature Flags | Env vars → LaunchDarkly | $0-$10/mo | 🟢 Medium |
| Logging | Pino | Free | 🟢 Medium |
| Release Automation | Release Please | Free | 🟢 Medium |
| Pair Programming | VS Code Live Share | Free | 🟢 Medium |

**Total Cost (Basic Stack):** ~$26/month
**Total Cost (Full Stack):** ~$100/month

---

## Getting Started

### Week 1: Foundation
1. Set up CI/CD (PLAN-9)
2. Fix failing tests (PLAN-6)
3. Establish code review process
4. First sprint planning

### Week 2-3: Quality
1. Add error tracking
2. Implement TDD workflow
3. Set up security scanning
4. First sprint review & retro

### Week 4+: Iterate
1. Add monitoring
2. Introduce feature flags
3. Optimize based on metrics
4. Continuous improvement
