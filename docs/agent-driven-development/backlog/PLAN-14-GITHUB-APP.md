# Implementation Plan: GitHub App Integration

**Status:** 📋 PLANNED
**Priority:** 🔴 CRITICAL - Primary distribution channel
**Scope:** apps/github-app (new) + apps/action
**Estimated Time:** 20-24 hours (2 weeks)
**Branch:** `feature/github-app`

## Overview

Build a GitHub App that automatically comments on PRs with code quality insights. This is the **primary growth lever** for startups - one-click install, viral discovery, and immediate value.

**Current State:**
- GitHub Action exists (manual YAML setup)
- ~5% adoption rate (requires technical setup)
- Hidden in workflows, not discoverable
- Requires per-repo configuration

**Target State:**
- GitHub App (one-click install)
- ~40% adoption rate (instant value)
- Visible on every PR, discoverable by all team members
- Org-wide installation option

**Impact:**
- **Startups:** Zero-config code quality on every PR
- **Viral Growth:** Every PR comment is a product demo
- **Business:** Primary acquisition channel

---

## Why GitHub App > GitHub Action

| Feature | GitHub Action | GitHub App |
|---------|---------------|------------|
| **Setup** | Manual YAML file | One-click install |
| **Discovery** | Hidden in Actions tab | Visible on every PR |
| **Visibility** | Only repo owners see | All team members see |
| **Installation** | Per-repo | Org-wide option |
| **Comments** | Generic workflow output | Rich inline comments |
| **Checks** | Basic | GitHub Checks API |
| **Permissions** | Repo-scoped | Fine-grained |
| **Adoption** | 5% (technical barrier) | 40% (instant value) |

---

## User Stories

### Story 1: Instant Setup

**As a** startup CTO
**I want** code quality checks on every PR without setup
**So that** my team ships higher quality code from day 1

**Acceptance Criteria:**
- [ ] Install app from GitHub Marketplace in <30 seconds
- [ ] Works immediately on next PR (no configuration)
- [ ] Works for both public and private repos
- [ ] Org-wide installation option available

**Story Points:** 8

---

### Story 2: Inline Code Comments

**As a** developer
**I want** quality issues shown directly on my code
**So that** I can fix them without context switching

**Acceptance Criteria:**
- [ ] Comments appear on specific lines with issues
- [ ] Each comment explains the problem and suggests a fix
- [ ] Severity indicated with emoji (🔴 critical, 🟡 warning, 🔵 info)
- [ ] Links to documentation for each finding

**Story Points:** 5

---

### Story 3: PR Check Status

**As a** team lead
**I want** quality gates enforced before merge
**So that** code quality doesn't degrade

**Acceptance Criteria:**
- [ ] Shows up in PR status checks
- [ ] Pass/fail based on configurable threshold
- [ ] Blocking merge if quality below threshold
- [ ] Summary visible without clicking through

**Story Points:** 3

---

### Story 4: Freemium Model

**As a** product owner
**I want** free usage for public repos, paid for private
**So that** we grow via OSS adoption and monetize enterprises

**Acceptance Criteria:**
- [ ] Public repos: unlimited free usage
- [ ] Private repos: 14-day trial
- [ ] Upgrade CTA in app comments
- [ ] Dashboard link for team features

**Story Points:** 5

---

## Technical Architecture

### System Overview

```
┌─────────────────────────────────────────────┐
│  GitHub (Webhook Events)                    │
│  - pull_request.opened                      │
│  - pull_request.synchronize                 │
│  - pull_request.reopened                    │
└─────────────────┬───────────────────────────┘
                  │ HTTPS POST
                  ▼
┌─────────────────────────────────────────────┐
│  GitHub App Server (Probot)                 │
│  - Verify webhook signature                 │
│  - Queue analysis job                       │
│  - Return 200 OK immediately                │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Worker Queue (BullMQ + Redis)              │
│  - Process jobs in background               │
│  - Retry failed jobs                        │
│  - Rate limiting                            │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Analysis Worker                            │
│  1. Fetch changed files from GitHub API    │
│  2. Run incremental audit (core package)    │
│  3. Format results for GitHub               │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  GitHub API (Post Results)                  │
│  - Create check run                         │
│  - Post inline comments                     │
│  - Update PR status                         │
└─────────────────────────────────────────────┘
```

### Data Flow

```typescript
// 1. GitHub webhook arrives
POST /webhook/github
{
  "action": "opened",
  "pull_request": {
    "number": 123,
    "head": { "sha": "abc123" },
    "base": { "ref": "main" }
  }
}

// 2. Queue analysis job
await queue.add('analyze-pr', {
  installationId: 12345,
  owner: 'acme-corp',
  repo: 'api',
  prNumber: 123,
  headSha: 'abc123'
})

// 3. Worker processes job
const files = await octokit.pulls.listFiles({ ... })
const results = await incrementalAnalysis(files)

// 4. Post to GitHub
await octokit.checks.create({
  name: 'Code Quality',
  head_sha: 'abc123',
  conclusion: results.score >= 7.0 ? 'success' : 'failure',
  output: { ... }
})

await octokit.pulls.createReviewComment({ ... })
```

---

## Implementation Waves

### Wave 1: GitHub App Infrastructure (8-10h)

**New Package Structure:**
```
apps/github-app/
├── src/
│   ├── index.ts           # Probot app entry
│   ├── handlers/
│   │   ├── pullRequest.ts # PR event handler
│   │   ├── installation.ts # Install/uninstall
│   │   └── marketplace.ts  # Subscription events
│   ├── workers/
│   │   ├── analyzer.ts    # Analysis worker
│   │   └── queue.ts       # Queue setup
│   ├── formatters/
│   │   ├── checkRun.ts    # Format for Checks API
│   │   ├── comments.ts    # Format PR comments
│   │   └── summary.ts     # Format PR summary
│   └── utils/
│       ├── github.ts      # GitHub API helpers
│       ├── auth.ts        # Installation auth
│       └── billing.ts     # Freemium logic
├── package.json
├── Dockerfile
└── vercel.json            # Deploy config
```

**Core Implementation:**

```typescript
// apps/github-app/src/index.ts

import { Probot } from 'probot'
import { handlePullRequest } from './handlers/pullRequest'
import { handleInstallation } from './handlers/installation'
import { setupQueue } from './workers/queue'

export default (app: Probot) => {
  // Initialize worker queue
  const queue = setupQueue()

  // Handle PR events
  app.on(
    [
      'pull_request.opened',
      'pull_request.synchronize',
      'pull_request.reopened'
    ],
    async (context) => {
      await handlePullRequest(context, queue)
    }
  )

  // Handle installation events (for billing)
  app.on(
    ['installation.created', 'installation.deleted'],
    async (context) => {
      await handleInstallation(context)
    }
  )

  // Health check
  app.route('/health').get((req, res) => {
    res.status(200).json({ status: 'ok' })
  })
}
```

```typescript
// apps/github-app/src/handlers/pullRequest.ts

import { Context } from 'probot'
import { Queue } from 'bullmq'

export async function handlePullRequest(
  context: Context<'pull_request'>,
  queue: Queue
) {
  const { payload } = context
  const { pull_request, repository, installation } = payload

  // Check if repo is eligible (freemium logic)
  const isPublic = !repository.private
  const hasSubscription = await checkSubscription(installation.id)

  if (!isPublic && !hasSubscription) {
    // Post upgrade CTA
    await context.octokit.issues.createComment({
      owner: repository.owner.login,
      repo: repository.name,
      issue_number: pull_request.number,
      body: upgradeMessage()
    })
    return
  }

  // Create pending check
  await context.octokit.checks.create({
    owner: repository.owner.login,
    repo: repository.name,
    name: 'Code Quality',
    head_sha: pull_request.head.sha,
    status: 'in_progress',
    output: {
      title: 'Analyzing code quality...',
      summary: '🤖 AI Code Auditor is analyzing your changes'
    }
  })

  // Queue analysis job
  await queue.add('analyze-pr', {
    installationId: installation.id,
    owner: repository.owner.login,
    repo: repository.name,
    prNumber: pull_request.number,
    headSha: pull_request.head.sha,
    baseSha: pull_request.base.sha
  })
}
```

```typescript
// apps/github-app/src/workers/analyzer.ts

import { Worker, Job } from 'bullmq'
import { incrementalAnalysis } from '@code-auditor/core'
import { createAppAuth } from '@octokit/auth-app'
import { Octokit } from '@octokit/rest'

interface AnalysisJob {
  installationId: number
  owner: string
  repo: string
  prNumber: number
  headSha: string
  baseSha: string
}

export function createAnalysisWorker() {
  return new Worker('analyze-pr', async (job: Job<AnalysisJob>) => {
    const { data } = job

    // Authenticate as installation
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: process.env.GITHUB_APP_ID!,
        privateKey: process.env.GITHUB_PRIVATE_KEY!,
        installationId: data.installationId
      }
    })

    // Fetch changed files
    const { data: files } = await octokit.pulls.listFiles({
      owner: data.owner,
      repo: data.repo,
      pull_number: data.prNumber
    })

    // Download file contents
    const fileContents = await Promise.all(
      files.map(async (file) => {
        if (file.status === 'removed') return null

        const { data: content } = await octokit.repos.getContent({
          owner: data.owner,
          repo: data.repo,
          path: file.filename,
          ref: data.headSha
        })

        return {
          path: file.filename,
          content: Buffer.from(content.content, 'base64').toString('utf-8'),
          language: detectLanguage(file.filename)
        }
      })
    )

    const validFiles = fileContents.filter(Boolean)

    // Run analysis
    const result = await incrementalAnalysis(validFiles, {
      cacheDir: `/tmp/cache/${data.owner}/${data.repo}`
    })

    // Post results to GitHub
    await postResults(octokit, data, result)

    return { success: true, score: result.overallScore }
  })
}
```

**Deployment:**

```yaml
# vercel.json
{
  "version": 2,
  "builds": [
    {
      "src": "apps/github-app/src/index.ts",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/webhook/github",
      "dest": "apps/github-app/src/index.ts"
    }
  ],
  "env": {
    "GITHUB_APP_ID": "@github-app-id",
    "GITHUB_PRIVATE_KEY": "@github-private-key",
    "ANTHROPIC_API_KEY": "@anthropic-api-key",
    "REDIS_URL": "@redis-url"
  }
}
```

**Acceptance:**
- [ ] Probot app running on Vercel
- [ ] Webhook signature verification working
- [ ] Jobs queued and processed in background
- [ ] Installation authentication working

---

### Wave 2: Inline Comments & Checks (6-8h)

**Format Results for GitHub:**

```typescript
// apps/github-app/src/formatters/comments.ts

export function formatInlineComment(finding: Finding): string {
  const severityEmoji = {
    critical: '🔴',
    warning: '🟡',
    info: '🔵'
  }

  return `${severityEmoji[finding.severity]} **${finding.title}**

${finding.description}

**Suggested Fix:**
\`\`\`${finding.language}
${finding.suggestion || 'See documentation for details'}
\`\`\`

---
*Powered by [AI Code Auditor](https://code-auditor.com) • [Learn more](https://code-auditor.com/docs/findings/${finding.type})*
`
}
```

```typescript
// apps/github-app/src/formatters/checkRun.ts

export function formatCheckRun(result: AuditResult) {
  const conclusion = result.overallScore >= 7.0 ? 'success' : 'failure'
  const emoji = result.overallScore >= 8.0 ? '✅' :
                 result.overallScore >= 6.0 ? '⚠️' : '❌'

  return {
    name: 'Code Quality',
    conclusion,
    output: {
      title: `${emoji} Quality Score: ${result.overallScore.toFixed(1)}/10`,
      summary: formatSummary(result),
      annotations: formatAnnotations(result.findings)
    }
  }
}

function formatSummary(result: AuditResult): string {
  return `
## Overall Quality: ${result.overallScore.toFixed(1)}/10

### Breakdown by Agent

| Agent | Score | Status |
|-------|-------|--------|
| Correctness | ${result.agents.correctness}/10 | ${scoreEmoji(result.agents.correctness)} |
| Security | ${result.agents.security}/10 | ${scoreEmoji(result.agents.security)} |
| Performance | ${result.agents.performance}/10 | ${scoreEmoji(result.agents.performance)} |
| Maintainability | ${result.agents.maintainability}/10 | ${scoreEmoji(result.agents.maintainability)} |
| Edge Cases | ${result.agents.edgeCases}/10 | ${scoreEmoji(result.agents.edgeCases)} |

### Top Issues

${result.findings.slice(0, 3).map(f =>
  `- ${severityEmoji(f.severity)} **${f.title}** in \`${f.file}:${f.line}\``
).join('\n')}

[View full report →](https://app.code-auditor.com/reports/${result.id})
`
}

function formatAnnotations(findings: Finding[]) {
  return findings
    .filter(f => f.line && f.file)
    .slice(0, 50)  // GitHub limit
    .map(f => ({
      path: f.file,
      start_line: f.line,
      end_line: f.endLine || f.line,
      annotation_level: f.severity === 'critical' ? 'failure' : 'warning',
      message: f.title,
      title: f.title,
      raw_details: f.description
    }))
}
```

**Post to GitHub:**

```typescript
// apps/github-app/src/workers/analyzer.ts (continued)

async function postResults(
  octokit: Octokit,
  job: AnalysisJob,
  result: AuditResult
) {
  // 1. Update check run
  const checkRun = formatCheckRun(result)
  await octokit.checks.create({
    owner: job.owner,
    repo: job.repo,
    head_sha: job.headSha,
    ...checkRun
  })

  // 2. Post inline comments (only critical/warnings)
  const criticalFindings = result.findings.filter(
    f => ['critical', 'warning'].includes(f.severity) && f.line
  )

  for (const finding of criticalFindings) {
    try {
      await octokit.pulls.createReviewComment({
        owner: job.owner,
        repo: job.repo,
        pull_number: job.prNumber,
        body: formatInlineComment(finding),
        path: finding.file,
        line: finding.line,
        side: 'RIGHT'
      })
    } catch (error) {
      // File might not be in diff, skip
      console.warn(`Could not comment on ${finding.file}:${finding.line}`)
    }
  }

  // 3. Post summary comment
  const summaryComment = formatSummaryComment(result)
  await octokit.issues.createComment({
    owner: job.owner,
    repo: job.repo,
    issue_number: job.prNumber,
    body: summaryComment
  })
}
```

**Example GitHub Check:**

```
✅ Code Quality — Quality Score: 8.2/10

Overall Quality: 8.2/10

Breakdown by Agent:
  Correctness:     8.5/10 ✅
  Security:        7.0/10 ⚠️
  Performance:     8.9/10 ✅
  Maintainability: 8.1/10 ✅
  Edge Cases:      8.5/10 ✅

Top Issues:
  - 🟡 Missing rate limiting in api/routes.ts:47
  - 🟡 Potential SQL injection in db/users.ts:123
  - 🔵 Consider caching in utils/fetch.ts:89

View full report →
```

**Example Inline Comment:**

```
🟡 Potential SQL Injection

This query uses string interpolation, which is vulnerable to SQL injection attacks.

**Current Code:**
```python
cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
```

**Suggested Fix:**
```python
cursor.execute("SELECT * FROM users WHERE id = ?", (user_id,))
```

---
Powered by AI Code Auditor • Learn more
```

**Acceptance:**
- [ ] Check runs appear in PR status
- [ ] Inline comments on specific lines
- [ ] Summary comment with full breakdown
- [ ] Links to full report work

---

### Wave 3: Freemium & Billing (4-6h)

**Billing Logic:**

```typescript
// apps/github-app/src/utils/billing.ts

interface Subscription {
  installationId: number
  plan: 'free' | 'trial' | 'pro' | 'team'
  trialEndsAt?: number
  isActive: boolean
}

export async function checkSubscription(
  installationId: number,
  isPublicRepo: boolean
): Promise<{ allowed: boolean; reason?: string }> {
  // Public repos always free
  if (isPublicRepo) {
    return { allowed: true }
  }

  // Check subscription status
  const sub = await db.subscription.findUnique({
    where: { installationId }
  })

  if (!sub) {
    // New installation: start trial
    await db.subscription.create({
      data: {
        installationId,
        plan: 'trial',
        trialEndsAt: Date.now() + 14 * 24 * 60 * 60 * 1000, // 14 days
        isActive: true
      }
    })
    return { allowed: true }
  }

  // Trial expired
  if (sub.plan === 'trial' && Date.now() > sub.trialEndsAt!) {
    return {
      allowed: false,
      reason: 'trial_expired'
    }
  }

  // Active subscription
  if (sub.isActive && ['pro', 'team'].includes(sub.plan)) {
    return { allowed: true }
  }

  return {
    allowed: false,
    reason: 'no_subscription'
  }
}

export function upgradeMessage(): string {
  return `
## 🚀 Upgrade to Continue Using AI Code Auditor

Your trial has ended! Upgrade to continue getting code quality insights on every PR.

### Pro Plan - $39/month
- ✅ Unlimited private repos
- ✅ All 5 AI agents
- ✅ Inline code comments
- ✅ Quality trend tracking
- ✅ 30-day audit history

[Upgrade Now](https://code-auditor.com/upgrade?installation=${installationId}) →

---
*Public repositories remain free forever.*
`
}
```

**GitHub Marketplace Integration:**

```typescript
// apps/github-app/src/handlers/marketplace.ts

export async function handleMarketplacePurchase(context: Context) {
  const { action, marketplace_purchase } = context.payload

  if (action === 'purchased') {
    await db.subscription.update({
      where: { installationId: marketplace_purchase.account.id },
      data: {
        plan: marketplace_purchase.plan.name,
        isActive: true
      }
    })
  }

  if (action === 'cancelled') {
    await db.subscription.update({
      where: { installationId: marketplace_purchase.account.id },
      data: {
        isActive: false
      }
    })
  }
}
```

**Acceptance:**
- [ ] Public repos work free forever
- [ ] Private repos get 14-day trial
- [ ] Upgrade CTA shown when trial expires
- [ ] GitHub Marketplace integration works

---

### Wave 4: Documentation & Launch (2-4h)

**GitHub Marketplace Listing:**

```markdown
# AI Code Auditor

Get instant code quality insights on every pull request, powered by Claude AI.

## Features

✅ **5 Specialized AI Agents** - Correctness, Security, Performance, Maintainability, Edge Cases
⚡ **Instant Feedback** - Results in <5 seconds with incremental analysis
📍 **Inline Comments** - Issues shown directly on your code
📊 **Quality Trends** - Track improvement over time
🔒 **Free for Public Repos** - Unlimited usage for open source

## How It Works

1. **Install** - One click to add to your repos
2. **Automatic** - Works on every PR, no configuration needed
3. **Review** - Get detailed feedback before merging
4. **Improve** - Track quality trends over time

## Pricing

- **Public Repos**: Free forever
- **Private Repos**: 14-day free trial, then $39/month

[Install Now →](https://github.com/apps/ai-code-auditor)
```

**Installation Guide:**

```markdown
# GitHub App Setup

## Quick Start

1. **Install the app**
   - Visit https://github.com/apps/ai-code-auditor
   - Click "Install"
   - Select repositories (all or specific)
   - Authorize

2. **First PR**
   - Open a new PR in any repo
   - AI Code Auditor runs automatically
   - See results in ~5 seconds

3. **Configure (optional)**
   - Add `.code-audit.json` to customize
   - Set quality thresholds
   - Choose agent profiles

## Configuration

```json
{
  "profile": "security-focused",
  "threshold": 7.0,
  "blockMerge": true
}
```

## Troubleshooting

**Q: App not running on my PRs?**
- Check app is installed for your repository
- Ensure you haven't exceeded rate limits
- Verify trial/subscription is active

**Q: How do I upgrade?**
- Visit https://code-auditor.com/upgrade
- Choose Pro or Team plan
- Link to your GitHub account
```

**Acceptance:**
- [ ] Marketplace listing approved
- [ ] Installation guide complete
- [ ] Troubleshooting docs written
- [ ] Launch announcement ready

---

## Performance Optimization

### Rate Limiting

```typescript
// Handle GitHub API rate limits
import { Bottleneck } from 'bottleneck'

const limiter = new Bottleneck({
  maxConcurrent: 10,
  minTime: 100  // 100ms between requests
})

const octokit = new Octokit({
  throttle: {
    onRateLimit: (retryAfter, options) => {
      console.warn(`Rate limit hit, retrying after ${retryAfter}s`)
      return true  // Retry
    },
    onSecondaryRateLimit: (retryAfter, options) => {
      console.warn(`Secondary rate limit, retrying after ${retryAfter}s`)
      return true
    }
  }
})
```

### Webhook Response Time

```typescript
// Respond to webhook within 10s
app.on('pull_request.opened', async (context) => {
  // Queue job immediately
  await queue.add('analyze-pr', { ... })

  // Return 200 OK
  return { status: 'queued' }
})

// Process in worker (no time limit)
```

### Caching Strategy

```typescript
// Cache analysis results per commit
const cacheKey = `${owner}/${repo}/${sha}`
const cached = await redis.get(cacheKey)

if (cached) {
  return JSON.parse(cached)
}

const result = await runAnalysis(...)
await redis.setex(cacheKey, 3600, JSON.stringify(result))  // 1 hour TTL
```

---

## Testing Strategy

### Unit Tests

```typescript
describe('GitHub App', () => {
  test('handles PR webhook', async () => {
    const payload = mockPRPayload()
    const context = mockContext(payload)

    await handlePullRequest(context, queue)

    expect(queue.add).toHaveBeenCalledWith('analyze-pr', {
      installationId: expect.any(Number),
      prNumber: 123,
      headSha: expect.any(String)
    })
  })

  test('checks subscription before analysis', async () => {
    const result = await checkSubscription(12345, false)
    expect(result.allowed).toBe(true)  // Trial
  })
})
```

### Integration Tests

```typescript
describe('End-to-End Flow', () => {
  test('PR analysis workflow', async () => {
    // 1. Simulate webhook
    await request(app)
      .post('/webhook/github')
      .send(mockPRPayload())
      .set('X-Hub-Signature', validSignature)
      .expect(200)

    // 2. Wait for worker to process
    await delay(5000)

    // 3. Verify check run created
    const checkRuns = await octokit.checks.listForRef({
      owner: 'test',
      repo: 'test-repo',
      ref: 'abc123'
    })

    expect(checkRuns.data).toContainEqual(
      expect.objectContaining({
        name: 'Code Quality',
        conclusion: expect.stringMatching(/success|failure/)
      })
    )
  })
})
```

---

## Monitoring & Alerting

**Metrics to Track:**
- Webhook delivery failures
- Job processing time (p50, p95, p99)
- API rate limit usage
- Worker queue depth
- Analysis errors

**Alerts:**
```typescript
// apps/github-app/src/monitoring.ts

import * as Sentry from '@sentry/node'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1
})

// Alert on high error rate
if (errorRate > 0.05) {
  await slack.post({
    channel: '#alerts',
    text: '🚨 GitHub App error rate >5%'
  })
}
```

---

## Rollout Plan

### Week 1: Alpha
- [ ] Deploy to staging
- [ ] Test with 3 internal repos
- [ ] Fix critical bugs
- [ ] Verify billing works

### Week 2: Beta
- [ ] Invite 10 friendly startups
- [ ] Gather feedback
- [ ] Iterate on UX
- [ ] Monitor performance

### Week 3: Public Launch
- [ ] Submit to GitHub Marketplace
- [ ] Launch on Product Hunt
- [ ] Announce on Twitter
- [ ] Monitor adoption metrics

---

## Success Metrics

### Week 1
- [ ] 50 installations
- [ ] <5s average analysis time
- [ ] 0 critical bugs

### Week 4
- [ ] 500 installations
- [ ] 10 paid conversions
- [ ] >8.0 NPS from users

### Week 12
- [ ] 5,000 installations
- [ ] 100 paid conversions ($3,900 MRR)
- [ ] Featured in GitHub Marketplace

---

## Definition of Done

- [ ] GitHub App created and deployed
- [ ] Webhook handling implemented
- [ ] Worker queue processing jobs
- [ ] Inline comments working
- [ ] Check runs showing in PRs
- [ ] Freemium billing logic complete
- [ ] Marketplace listing live
- [ ] Documentation complete
- [ ] Beta tested with 10 users
- [ ] Performance metrics meet targets
- [ ] Launched publicly

**Ready to ship when all checkboxes are ✓**
