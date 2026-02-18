# Implementation Plan: CI/CD Infrastructure

**Status:** ✅ COMPLETED (2026-02-15)
**Priority:** 🔴 CRITICAL - Foundation for Agile/TDD workflow
**Scope:** Root + apps/web
**Agent Strategy:** RESUME apps/web agent from PLAN-6
**Actual Time:** 3 hours
**Branch:** `feature/cicd-pipeline` → merged to `main`

## Completion Summary

**Final Results:**
- ✅ GitHub Actions CI/CD pipeline implemented
- ✅ All quality gates passing (test, lint, build)
- ✅ Vercel deployment workflows configured
- ✅ Documentation created (docs/CI-CD-SETUP.md)
- ✅ ESLint configured and all errors fixed
- ✅ Local verification complete

**CI Pipeline:**
- **test** job (5-7min): Unit tests + linting via Turborepo
- **coverage** job (5-7min): Code coverage tracking (Codecov optional)
- **deploy-preview** job (2-3min): Vercel preview on PRs
- **deploy-production** job (2-3min): Vercel production on main push
- **Total runtime**: ~10-15 minutes per PR

**What Was Built:**
1. `.github/workflows/ci.yml` - Complete CI/CD pipeline
2. `docs/CI-CD-SETUP.md` - Setup guide with troubleshooting
3. `.eslintrc.json` - ESLint configuration for Next.js
4. Fixed all linting errors (3 JSX apostrophe issues)
5. Removed non-existent dependency blocking builds

**Manual Steps Required:**
- Branch protection rules (documented in CI-CD-SETUP.md)
- GitHub Secrets for Vercel deployment (optional)
- Codecov token for coverage tracking (optional)

**Agent Execution:**

```
web-001 (RESUME from PLAN-6): ✅ COMPLETED
  Role: DevOps
  Context: Already knows test structure from fixing tests
  Tasks:
    1. GitHub Actions workflow [2h] ✅
    2. ESLint setup + fixes [1h] ✅
    3. Documentation [30min] ✅
    4. Local verification [30min] ✅
```

**Dependencies:** PLAN-6 complete (need passing tests)
**Context reuse:** Agent already knows apps/web test structure, mocks, API routes

## Overview

Implement automated CI/CD pipeline to enable fast feedback loops, automated quality gates, and continuous deployment.

**Current State:**
- Manual testing before deploy
- No automated checks
- No deployment pipeline
- Slow feedback (hours to days)

**Target State:**
- Automated testing on every commit
- Quality gates (tests, lint, coverage)
- Automated deployment to staging
- Fast feedback (<5 minutes)

---

## User Stories

### Story 1: Automated Testing on PR

**As a** developer
**I want** tests to run automatically on every PR
**So that** I know if my changes break anything

**Acceptance Criteria:**
- [ ] Tests run on every push to PR
- [ ] Results visible in GitHub PR
- [ ] PRs blocked if tests fail
- [ ] Runs in <5 minutes

**Story Points:** 3

---

### Story 2: Code Quality Gates

**As a** team lead
**I want** automated quality checks on every PR
**So that** code quality doesn't degrade

**Acceptance Criteria:**
- [ ] Linting runs automatically
- [ ] Coverage must be ≥80%
- [ ] Type checking passes
- [ ] No critical security issues

**Story Points:** 2

---

### Story 3: Automated Deployment

**As a** developer
**I want** changes to deploy automatically to staging
**So that** I can test in production-like environment

**Acceptance Criteria:**
- [ ] Merges to main → deploy to staging
- [ ] Rollback on deployment failure
- [ ] Deployment status in Slack
- [ ] Database migrations run automatically

**Story Points:** 5

---

## Implementation

### GitHub Actions Workflow

```yaml
# .github/workflows/ci.yml
name: CI/CD Pipeline

on:
  pull_request:
    branches: [main, develop]
  push:
    branches: [main, develop]

jobs:
  test:
    name: Test & Lint
    runs-on: ubuntu-latest
    timeout-minutes: 10

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: 1.3.6

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Build packages
        run: bun run build

      - name: Run tests
        run: bun run test

      - name: Lint
        run: bun run lint

      - name: Type check
        run: bun run type-check

      - name: Coverage report
        run: bun run test:coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

      - name: Check coverage threshold
        run: |
          COVERAGE=$(cat coverage/coverage-summary.json | jq '.total.lines.pct')
          if (( $(echo "$COVERAGE < 80" | bc -l) )); then
            echo "Coverage $COVERAGE% is below 80% threshold"
            exit 1
          fi

  security:
    name: Security Scan
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Run Trivy vulnerability scanner
        uses: aquasecurity/trivy-action@master
        with:
          scan-type: 'fs'
          scan-ref: '.'
          severity: 'CRITICAL,HIGH'

      - name: Audit dependencies
        run: bun audit

  deploy-staging:
    name: Deploy to Staging
    needs: [test, security]
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - name: Deploy to Vercel (staging)
        uses: amondnet/vercel-action@v25
        with:
          vercel-token: ${{ secrets.VERCEL_TOKEN }}
          vercel-org-id: ${{ secrets.VERCEL_ORG_ID }}
          vercel-project-id: ${{ secrets.VERCEL_PROJECT_ID }}
          scope: ${{ secrets.VERCEL_ORG_ID }}

      - name: Run smoke tests
        run: bun run test:smoke
        env:
          STAGING_URL: ${{ steps.deploy.outputs.preview-url }}

      - name: Notify Slack
        uses: 8398a7/action-slack@v3
        with:
          status: ${{ job.status }}
          text: 'Staging deployment: ${{ steps.deploy.outputs.preview-url }}'
        env:
          SLACK_WEBHOOK_URL: ${{ secrets.SLACK_WEBHOOK }}
```

### Branch Protection Rules

```yaml
# Settings → Branches → Branch protection rules for 'main'

Required status checks:
  ✓ Test & Lint
  ✓ Security Scan
  ✓ Coverage ≥80%

Required reviews: 1
Require linear history: true
Do not allow bypassing: true
```

### Coverage Configuration

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80
      },
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.test.ts',
        '**/__tests__/**'
      ]
    }
  }
})
```

---

## Quality Gates

### Required Checks
- ✅ All tests pass
- ✅ Lint passes (no errors)
- ✅ Type check passes
- ✅ Coverage ≥80%
- ✅ No critical security vulnerabilities
- ✅ 1+ code review approval

### Optional Checks (warnings)
- ⚠️ Performance regression
- ⚠️ Bundle size increase >10%
- ⚠️ Dependency updates available

---

## Monitoring & Alerts

### Slack Notifications
- ✅ PR opened/updated
- ✅ CI failed
- ✅ Deployment succeeded/failed
- ✅ Coverage dropped below threshold

### Dashboard
- Codecov for coverage trends
- GitHub Actions dashboard
- Vercel deployment logs

---

## Rollback Strategy

### Automatic Rollback
```yaml
- name: Health check
  run: curl -f ${{ steps.deploy.outputs.preview-url }}/api/health || exit 1

- name: Rollback on failure
  if: failure()
  run: vercel rollback --yes
```

### Manual Rollback
```bash
# Revert to previous deployment
vercel rollback <deployment-id>

# Or revert commit and force push
git revert HEAD
git push origin main --force-with-lease
```

---

## Definition of Done

- [ ] CI runs on every PR
- [ ] Tests must pass to merge
- [ ] Coverage ≥80% enforced
- [ ] Auto-deploy to staging on merge to main
- [ ] Slack notifications configured
- [ ] Rollback tested and documented
- [ ] Team trained on workflow

---

## Sprint Ceremonies

### Daily Standup (15min)
- What did I complete yesterday?
- What will I complete today?
- Any blockers?
- CI/CD status check

### Sprint Planning (2h every 2 weeks)
- Review backlog
- Estimate stories (planning poker)
- Commit to sprint goal
- Define acceptance criteria

### Sprint Review (1h)
- Demo completed stories to stakeholders
- Get feedback
- Update backlog priorities

### Sprint Retrospective (1h)
- What went well?
- What didn't go well?
- Action items for next sprint

---

## Metrics to Track

- **Build Time**: <5 minutes
- **Test Time**: <2 minutes
- **Deployment Time**: <3 minutes
- **Mean Time to Recovery**: <15 minutes
- **Deployment Frequency**: Multiple per day
- **Change Failure Rate**: <5%

---

## Follow-up Work

- Add performance regression testing
- Add visual regression testing (Percy/Chromatic)
- Add canary deployments
- Add feature flags (LaunchDarkly)
- Add monitoring (DataDog/New Relic)
- Add error tracking (Sentry)
