# Quick Start - Testing GitHub Action

This guide helps you test the GitHub Action locally and in a test repository.

## Prerequisites

1. **Anthropic API Key**: Get from [console.anthropic.com](https://console.anthropic.com)
2. **GitHub Repository**: Public or private repo with code
3. **Bun installed**: For local development

## Step 1: Build the Action

```bash
cd /Users/nori/Projects/ai-code-auditor
bun install
bun run build:action
```

Verify `dist/action.js` exists and is ~1.7MB.

## Step 2: Test Locally (CLI)

Before testing as GitHub Action, verify the CLI works:

```bash
# Set API key
export ANTHROPIC_API_KEY='your-key-here'

# Test on a sample file
bun run src/cli.ts src/agents/correctness.ts

# Test on directory
bun run src/cli.ts src/
```

You should see a colored report with scores and findings.

## Step 3: Set Up Test Repository

### Option A: Test in This Repository

1. **Add API key as secret**:
   - Go to repository Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `ANTHROPIC_API_KEY`
   - Value: Your API key

2. **Create a test PR**:
   ```bash
   git checkout -b test-github-action
   # Make some code changes
   echo "console.log('test');" >> src/test.ts
   git add src/test.ts
   git commit -m "test: trigger action"
   git push origin test-github-action
   ```

3. **Open PR on GitHub** and watch the action run

### Option B: Test in Separate Repo

1. **Create new test repo** on GitHub
2. **Add workflow file** at `.github/workflows/code-audit.yml`:

```yaml
name: Test AI Code Auditor

on:
  pull_request:
    types: [opened, synchronize]

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      # Use local action (for testing)
      - uses: your-org/ai-code-auditor@feature/github-actions
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          path: 'src/'
          fail-on-critical: 'false'
```

3. **Add ANTHROPIC_API_KEY** as repository secret
4. **Create PR** with some code changes
5. **Check Actions tab** for workflow run

## Step 4: Verify Action Behavior

### Expected Workflow:

1. **Trigger**: PR opened/updated
2. **Checkout**: Code checked out
3. **Discover**: Changed files detected
4. **Audit**: 5 agents analyze code in parallel
5. **Comment**: Report posted/updated on PR

### Check PR Comment:

- [ ] Comment starts with "🤖 AI Code Auditor Report"
- [ ] Overall score shown (X.X/10 with stars)
- [ ] Findings summary (🔴 critical, 🟡 warning, 🔵 info)
- [ ] Agent breakdown (collapsible)
- [ ] Top recommendations (collapsible)
- [ ] Footer with CTA (public vs private)

### Check Workflow Outputs:

Click on workflow run → View job → Expand "Run AI Code Auditor" step:

```
Output:
  score: 7.2
  critical-count: 2
  warning-count: 5
  info-count: 3
  report-url: https://github.com/...
```

### Check Comment Updates:

1. Update PR with more changes
2. Push new commit
3. Verify comment is **updated** (not duplicated)

## Step 5: Test Fail Conditions

### Test fail-on-critical:

```yaml
- uses: your-org/ai-code-auditor@feature/github-actions
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on-critical: 'true'
```

- Add code with obvious critical issue (SQL injection, hardcoded secrets)
- Push to PR
- Workflow should **fail** with red X

### Test min-score:

```yaml
- uses: your-org/ai-code-auditor@feature/github-actions
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    min-score: '9.0'
```

- Push mediocre code
- Workflow should **fail** if score < 9.0

## Step 6: Test Edge Cases

### No files changed:

- Create PR that only changes README.md
- Should post comment: "No code files were changed in this PR"

### Too many files:

- Create PR changing 100+ files
- Should limit to 50 files (default max-files)
- Check workflow logs for: "Too many files, limiting to 50"

### Missing API key:

- Remove ANTHROPIC_API_KEY secret
- Workflow should fail with: "Input required and not supplied: anthropic-api-key"

### Invalid API key:

- Set ANTHROPIC_API_KEY to invalid value
- Workflow should fail and post error comment to PR

## Step 7: Test Public vs Private

### Public repo:
- Comment footer should show: "✨ Free audit for public repos! [Add to your repo](...)"

### Private repo:
- Comment footer should show: "🔒 Private repo audit • [Upgrade to Pro](...)"

## Debugging Tips

### View workflow logs:
1. Go to Actions tab
2. Click on workflow run
3. Click on job name
4. Expand steps to see detailed logs

### Common issues:

**"ANTHROPIC_API_KEY not found"**
- Check repository secrets (Settings → Secrets)
- Verify secret name matches exactly

**"Permission denied to post comment"**
- Check workflow permissions in YAML:
  ```yaml
  permissions:
    contents: read
    pull-requests: write  # Required
  ```

**"No files to audit"**
- Check that PR changes code files (.ts, .js, .py, etc)
- Try specifying path explicitly

**"Rate limit exceeded"**
- GitHub API has limits
- Wait a few minutes and retry

### Test action.ts locally:

You can test the action entry point locally (won't post to GitHub):

```bash
export ANTHROPIC_API_KEY='your-key'
export INPUT_ANTHROPIC_API_KEY='your-key'
export INPUT_PATH='src/'
export INPUT_MODEL='claude-sonnet-4-5-20250929'

node dist/action.js
```

This simulates the action environment without GitHub context.

## Success Checklist

Before considering Phase 2 complete:

- [ ] Build succeeds (`bun run build:action`)
- [ ] dist/action.js exists (~1.7MB)
- [ ] CLI works locally
- [ ] Action runs on PR
- [ ] Comment is posted to PR
- [ ] Comment is updated on PR update (not duplicated)
- [ ] Comment has correct format (scores, findings, CTA)
- [ ] Public/private CTAs work correctly
- [ ] fail-on-critical works
- [ ] min-score works
- [ ] Error handling works (posts error comment)
- [ ] Changed files detection works
- [ ] max-files limiting works

## Next Steps

Once testing is complete:

1. **Merge to main**: Merge feature/github-actions branch
2. **Tag release**: Create v1.0.0 tag
3. **Publish to Marketplace**: List on GitHub Marketplace
4. **Update docs**: Replace "your-org" with actual GitHub username/org
5. **Promote**: Share on social media, dev communities

## Support

If you encounter issues:

1. Check workflow logs first
2. Review GITHUB_ACTION.md documentation
3. Create issue on GitHub repo
4. Include: workflow logs, PR link, error messages

---

**Happy testing! 🚀**
