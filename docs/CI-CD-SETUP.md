# CI/CD Setup Guide

**Quick Reference**: This project uses GitHub Actions for CI/CD with automated testing and Vercel deployment.

## Current Status

✅ **Implemented:**
- Unit tests (35 tests) run on every PR/push
- Linting and build checks
- Code coverage tracking
- Vercel preview deployments on PRs
- Vercel production deployments on main branch

⏸️ **Skipped (for now):**
- E2E tests in CI (require real DB/Redis, run locally pre-commit)
- Coverage threshold enforcement (needs baseline establishment)

## GitHub Actions Workflows

### Main CI Pipeline (`.github/workflows/ci.yml`)

**Triggers:**
- Pull requests to `main`
- Pushes to `main`

**Jobs:**

1. **test** (5-7min) - Unit tests, linting, builds
   - Runs `bun run test` (all workspaces via Turborepo)
   - Runs `bun run lint`
   - Requires all tests passing

2. **coverage** (5-7min) - Code coverage reporting
   - Runs `bun run test:coverage` in apps/web
   - Uploads to Codecov (optional, continues on error)

3. **deploy-preview** (2-3min) - Preview deployments
   - Only on PRs
   - Deploys to Vercel preview environment
   - Comments PR with preview URL

4. **deploy-production** (2-3min) - Production deployments
   - Only on pushes to `main`
   - Deploys to Vercel production

**Total CI time:** ~10-15 minutes per PR

### Other Workflows

- **code-audit.yml** - AI code quality checks (optional, requires API key)
- **self-audit.yml** - Dogfooding self-audit (optional, requires API key)

---

## Required GitHub Secrets

### Essential (for CI to pass)

None! Unit tests run without external dependencies.

### Optional (for full functionality)

**Vercel Deployment:**
- `VERCEL_TOKEN` - From https://vercel.com/account/tokens
- `VERCEL_ORG_ID` - From Vercel project settings
- `VERCEL_PROJECT_ID` - From Vercel project settings

**Code Coverage (Codecov):**
- `CODECOV_TOKEN` - From https://codecov.io (optional, continues on error)

**E2E Tests (disabled by default):**
- `CI_DATABASE_URL` - PostgreSQL connection string for test database
- `UPSTASH_REDIS_REST_URL` - Redis URL for rate limiting tests
- `UPSTASH_REDIS_REST_TOKEN` - Redis token

**AI Code Audit (optional):**
- `ANTHROPIC_API_KEY` - For code-audit.yml and self-audit.yml

---

## Branch Protection Rules (Manual Setup)

**IMPORTANT:** These must be configured manually in GitHub Settings.

Go to: **Settings → Branches → Add rule** for `main`

### Required Settings

✅ **Require a pull request before merging**
- Required approvals: 1 (recommended)

✅ **Require status checks to pass before merging**
- Add required checks:
  - `Test & Lint` (CRITICAL - blocks broken code)
  - `Coverage Check` (recommended)

✅ **Require branches to be up to date before merging**
- Ensures tests run against latest main

✅ **Do not allow bypassing the above settings**
- Protects against accidental merges

### Optional Settings

- **Require linear history** - Cleaner git history (recommended)
- **Require deployments to succeed** - Wait for Vercel deployment
- **Restrict pushes** - Only allow via PRs

---

## Local Development Workflow

### Before Creating PR

```bash
# Run all checks locally
bun run build          # Verify builds
bun run test           # Unit tests (35 tests)
cd apps/web && bun run test:e2e  # E2E tests (10 tests, 7 skipped)
bun run lint           # Linting

# Or run everything at once
bun run build && bun run test && bun run lint
```

### Creating PR

1. Push branch: `git push origin your-branch-name`
2. GitHub Actions will automatically run tests
3. Wait for ✅ green checkmarks before requesting review
4. If tests fail, fix and push again (CI reruns automatically)

### After PR Approval

1. Merge PR (requires passing tests)
2. GitHub Actions deploys to Vercel production automatically
3. Verify deployment: https://your-app.vercel.app

---

## E2E Tests in CI (Future Enhancement)

**Current state:** E2E tests run locally but are **skipped in CI** (see `if: false` in workflow).

**Why skipped:**
- Require real PostgreSQL database
- Require real Redis instance
- Slower (~40s runtime)
- More complex to maintain

**To enable:**
1. Set up test database (e.g., Railway, Supabase free tier)
2. Set up test Redis (e.g., Upstash free tier)
3. Add secrets: `CI_DATABASE_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`
4. Change `if: false` to `if: true` in `.github/workflows/ci.yml`

**Alternative:** Keep E2E tests as local pre-commit check (current approach).

---

## Coverage Thresholds (Future Enhancement)

**Current state:** Coverage is tracked but **no enforcement** (continues on error).

**Recommended thresholds:**
- Lines: 80%
- Functions: 80%
- Branches: 70%
- Statements: 80%

**To enable:**
1. Establish baseline coverage
2. Update `apps/web/vitest.config.ts` with thresholds:
   ```typescript
   coverage: {
     thresholds: {
       lines: 80,
       functions: 80,
       branches: 70,
       statements: 80
     }
   }
   ```
3. Remove `continue-on-error: true` from coverage job

---

## Troubleshooting

### Tests Fail Locally But Pass in CI

**Cause:** Environment differences (env vars, dependencies)

**Fix:**
```bash
# Clean install
rm -rf node_modules
bun install --frozen-lockfile
bun run build
bun run test
```

### Tests Pass Locally But Fail in CI

**Cause:** Forgotten dependency or missing build step

**Fix:**
- Check if you added dependencies: `bun add <package>`
- Check if you need to rebuild: `bun run build`
- Check turbo.json for task dependencies

### Vercel Deployment Fails

**Cause:** Missing secrets or build errors

**Fix:**
1. Check GitHub Secrets are set correctly
2. Check Vercel build logs for errors
3. Verify `vercel.json` configuration
4. Test build locally: `cd apps/web && bun run build`

### CI Times Out

**Cause:** Tests hanging or infinite loops

**Fix:**
- Check for `await` missing in async tests
- Check for infinite loops in code
- Increase timeout in `.github/workflows/ci.yml` (max 30min for free tier)

---

## Monitoring & Alerts

### GitHub Actions

- View runs: **Actions** tab in GitHub
- Email notifications: Enabled by default for failures
- Configure: **Settings → Notifications** in your GitHub account

### Vercel

- View deployments: https://vercel.com/dashboard
- Email notifications: Enabled by default
- Configure: Vercel project settings

### Codecov (Optional)

- View coverage: https://codecov.io/gh/your-org/your-repo
- Configure notifications in Codecov settings

---

## Best Practices

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat(web): add user dashboard`
- `fix(cli): resolve rate limiting bug`
- `test(web): add API key tests`
- `docs: update CI/CD setup guide`

### PR Size

- Keep PRs **small** (<500 lines changed)
- Break large features into multiple PRs
- CI runs faster on smaller PRs

### Test Coverage

- Add tests for **new features**
- Add tests for **bug fixes**
- Aim for **80% coverage** (not enforced yet)

### Deployment Strategy

- **PRs:** Preview deployments (test changes safely)
- **Main branch:** Production deployments (automatic)
- **Critical bugs:** Hotfix → PR → merge → auto-deploy

---

## Future Enhancements

**Planned improvements:**

1. **E2E tests in CI** - Set up test DB/Redis
2. **Coverage thresholds** - Enforce 80% minimum
3. **Performance budgets** - Lighthouse CI for web vitals
4. **Security scanning** - Trivy, npm audit in CI
5. **Smoke tests** - After production deploy
6. **Slack notifications** - For deployment status

See `docs/agent-driven-development/backlog/` for detailed plans.
