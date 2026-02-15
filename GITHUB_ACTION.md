# GitHub Action Documentation

AI Code Auditor can be integrated into your GitHub workflows to automatically audit code quality on every pull request.

## Quick Start

1. **Add workflow file** to your repository at `.github/workflows/code-audit.yml`:

```yaml
name: Code Quality Audit

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
      - uses: your-org/ai-code-auditor@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

2. **Add your Anthropic API key** as a repository secret:
   - Go to your repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Name: `ANTHROPIC_API_KEY`
   - Value: Your API key from [console.anthropic.com](https://console.anthropic.com)

3. **Open a PR** and watch the audit run automatically!

## Configuration

### Inputs

| Input | Description | Required | Default |
|-------|-------------|----------|---------|
| `anthropic-api-key` | Anthropic API key for Claude | Yes | - |
| `github-token` | GitHub token (auto-provided) | Yes | `${{ github.token }}` |
| `path` | Path to audit (file or directory) | No | Changed files in PR |
| `model` | Claude model to use | No | `claude-sonnet-4-5-20250929` |
| `fail-on-critical` | Fail workflow if critical issues found | No | `false` |
| `min-score` | Minimum acceptable score (0-10) | No | `0` |
| `max-files` | Maximum files to audit (prevents API abuse) | No | `50` |

### Outputs

| Output | Description |
|--------|-------------|
| `score` | Overall quality score (0-10) |
| `critical-count` | Number of critical findings |
| `warning-count` | Number of warning findings |
| `info-count` | Number of info findings |
| `report-url` | URL to PR comment with full report |

## Examples

### Basic Usage (Changed Files Only)

```yaml
- uses: your-org/ai-code-auditor@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

This will audit only the files changed in the PR.

### Audit Specific Directory

```yaml
- uses: your-org/ai-code-auditor@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    path: 'src/'
```

### Fail on Critical Issues

```yaml
- uses: your-org/ai-code-auditor@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    fail-on-critical: 'true'
```

This will mark the workflow as failed if any critical issues are found.

### Enforce Minimum Score

```yaml
- uses: your-org/ai-code-auditor@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    min-score: '7.0'
```

Workflow fails if overall score is below 7.0.

### Use Different Model

```yaml
- uses: your-org/ai-code-auditor@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    model: 'claude-opus-4-6'
```

Available models:
- `claude-sonnet-4-5-20250929` (default, fast, cost-effective)
- `claude-opus-4-6` (most capable, slower, more expensive)
- `claude-haiku-4` (fastest, cheapest, less detailed)

### Use Outputs in Later Steps

```yaml
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - id: audit
        uses: your-org/ai-code-auditor@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Check score
        run: |
          echo "Quality Score: ${{ steps.audit.outputs.score }}"
          echo "Critical Issues: ${{ steps.audit.outputs.critical-count }}"
          echo "Report: ${{ steps.audit.outputs.report-url }}"
```

### Monorepo - Audit Multiple Directories

```yaml
jobs:
  audit-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/ai-code-auditor@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          path: 'packages/frontend/'

  audit-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: your-org/ai-code-auditor@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          path: 'packages/backend/'
```

## Pricing

### Free Tier

**Public repositories** get unlimited free audits with attribution in PR comments.

### Pro Tier - $29/month

**Private repositories** require a Pro subscription:
- Unlimited private repo audits
- Priority support
- Custom models
- Advanced configuration

[Subscribe to Pro](https://github.com/marketplace/actions/ai-code-auditor)

## How It Works

1. **Trigger**: Workflow runs on PR open/update
2. **Discovery**: Detects changed files or audits specified path
3. **Analysis**: 5 specialist AI agents analyze the code:
   - Correctness (25% weight)
   - Security (25% weight)
   - Performance (15% weight)
   - Maintainability (20% weight)
   - Edge Cases (15% weight)
4. **Report**: Posts/updates PR comment with results
5. **Fail Conditions**: Optionally fails workflow based on findings

## PR Comment Format

The action posts a comprehensive report as a PR comment:

```markdown
## 🤖 AI Code Auditor Report

**Overall Score:** 7.2/10 ⭐⭐⭐⭐

### 📊 Findings Summary
- 🔴 **2 Critical** issues
- 🟡 **5 Warnings**
- 🔵 **3 Info**

<details>
<summary>📈 Agent Breakdown</summary>
[Agent scores and status...]
</details>

<details>
<summary>🎯 Top Recommendations</summary>
[Critical issues with file locations...]
</details>
```

The comment:
- Collapses details to save space
- Shows only critical issues by default
- Provides direct links to files/lines
- Updates in place (no duplicate comments)
- Includes marketing footer for viral growth

## Troubleshooting

### "API key not found"

Make sure you've added `ANTHROPIC_API_KEY` as a repository secret and referenced it correctly:

```yaml
anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### "No files to audit"

If you're seeing this on a PR with changes:

1. Check that changed files have code extensions (`.ts`, `.js`, `.py`, etc.)
2. Try specifying `path` explicitly
3. Make sure files aren't deleted (we only audit added/modified files)

### "Too many files"

If your PR changes many files, the action limits to 50 by default (to prevent excessive API usage). Options:

1. Increase `max-files` input
2. Use `path` to audit specific directories
3. Split large PRs into smaller ones

### "Rate limit exceeded"

GitHub API has rate limits. If you're running many workflows:

1. Use `github-token` with higher rate limits
2. Space out workflow runs
3. Contact support for increased limits

### "Comment not posted"

Check workflow permissions:

```yaml
permissions:
  contents: read
  pull-requests: write  # Required for posting comments
```

## Advanced Configuration

### Organization-wide Configuration

Create `.github/workflows/code-audit.yml` in your `.github` repository to apply to all repos in your organization.

### Custom Model Configuration

For specialized use cases:

```yaml
- uses: your-org/ai-code-auditor@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    model: 'claude-opus-4-6'  # Most thorough
    max-files: '20'  # Limit for detailed analysis
```

### Conditional Execution

Only run on specific branches:

```yaml
on:
  pull_request:
    branches:
      - main
      - develop
```

Only run on specific file changes:

```yaml
on:
  pull_request:
    paths:
      - 'src/**'
      - '!src/**/*.test.ts'
```

## Support

- **Documentation**: [github.com/your-org/ai-code-auditor](https://github.com/your-org/ai-code-auditor)
- **Issues**: [github.com/your-org/ai-code-auditor/issues](https://github.com/your-org/ai-code-auditor/issues)
- **Discussions**: [github.com/your-org/ai-code-auditor/discussions](https://github.com/your-org/ai-code-auditor/discussions)
- **Pro Support**: support@your-domain.com

## Contributing

We welcome contributions! See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](./LICENSE) for details.
