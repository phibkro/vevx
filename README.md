# AI Code Auditor

**Multi-agent AI code quality analysis powered by Claude**

Get comprehensive, actionable feedback across 7 specialized dimensions: correctness, security, performance, maintainability, edge cases, accessibility, and documentation.

```bash
# Audit your codebase
code-audit src/

# Get instant quality insights
✓ Correctness     8.5/10
✓ Security        9.2/10
⚠ Performance     6.8/10
✓ Maintainability 8.1/10
⚠ Edge Cases      6.5/10

Overall Score: 7.8/10 ⭐⭐⭐⭐
```

## Why AI Code Auditor?

**🎯 Specialized Analysis** - Seven AI agents, each an expert in a specific quality dimension, analyze your code in parallel for deeper insights than generic code review tools.

**⚡ Fast & Comprehensive** - Get detailed analysis in seconds. Identifies issues human reviewers often miss: race conditions, edge cases, security vulnerabilities, and performance bottlenecks.

**📊 Actionable Reports** - Color-coded terminal output, markdown exports, and optional dashboard integration. Track quality trends over time and share results with your team.

**🔧 Works Anywhere** - CLI tool, web dashboard, or GitHub Action. Supports TypeScript, JavaScript, Python, Go, Rust, Java, and C/C++.

## Quick Start

### CLI Tool

```bash
# Install (macOS)
brew install ai-code-auditor

# Or download binary from releases
curl -L https://github.com/yourorg/ai-code-auditor/releases/latest/download/code-audit-darwin-arm64 -o code-audit
chmod +x code-audit

# Set your Anthropic API key
export ANTHROPIC_API_KEY='your-key-here'

# Audit a file or directory
code-audit src/

# Save report
code-audit src/ --output report.md
```

### GitHub Action

Add to `.github/workflows/code-audit.yml`:

```yaml
name: Code Quality
on: [pull_request]

permissions:
  contents: read
  pull-requests: write

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: yourorg/ai-code-auditor@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

Every PR automatically gets quality feedback as a comment.

### Web Dashboard

Track quality over time and collaborate with your team:

1. **Sign up** at https://code-auditor.com
2. **Create team** and invite members
3. **Get API key** from dashboard
4. **Login from CLI**: `code-audit login`
5. **Run audits**: Results automatically sync to dashboard

[See dashboard setup guide →](apps/web/README.md)

## How It Works

AI Code Auditor uses **7 specialized AI agents** that analyze your code in parallel:

### 1. Correctness Agent (22%)
Finds logic errors, type safety issues, incorrect API usage, and null handling problems.

### 2. Security Agent (22%)
Identifies SQL injection, XSS, authentication issues, data exposure, and crypto weaknesses.

### 3. Performance Agent (13%)
Detects algorithmic complexity issues, memory leaks, inefficient database queries, and missing caching opportunities.

### 4. Maintainability Agent (15%)
Analyzes code complexity, error handling, code duplication, and naming conventions.

### 5. Edge Cases Agent (13%)
Uncovers boundary conditions, race conditions, resource exhaustion, and rare failure scenarios.

### 6. Accessibility Agent (10%)
Checks WCAG compliance, semantic HTML, ARIA attributes, keyboard navigation, and screen reader compatibility.

### 7. Documentation Agent (5%)
Ensures public APIs are documented with JSDoc/TSDoc, complex logic is explained, and examples are provided.

Each agent returns a score (0-10) with detailed findings. The **overall score** is a weighted average based on the importance of each dimension.

[Learn more about the architecture →](docs/ARCHITECTURE.md)

## Features

### CLI Tool
- ⚡ **Fast analysis** - Results in seconds
- 🎨 **Rich terminal output** - Color-coded, scannable reports
- 📝 **Multiple output formats** - JSON, Markdown, HTML, or Text
- 🔄 **Dashboard sync** - Optional cloud integration
- 👀 **Watch mode** - Continuous analysis on file changes
- 🎛️ **Configurable** - Customize models, weights, and thresholds
- 🔧 **Verbosity levels** - Quiet, normal, verbose, or debug output
- ⌨️ **Shell completions** - Bash and Zsh support

### Web Dashboard
- 👥 **Team collaboration** - Share results across your team
- 📈 **Quality trends** - Track improvements over time
- 🔐 **Role-based access** - Owner, admin, member, and viewer roles
- 💳 **Flexible plans** - Free, Pro, and Team tiers
- 🔑 **API key management** - Secure CLI authentication

### GitHub Action
- 💬 **Automatic PR comments** - Quality reports on every pull request
- 🎯 **Changed files only** - Analyzes PR diff, not entire codebase
- 🚫 **Optional workflow failure** - Block merges on critical issues
- 📊 **Trend tracking** - Compare quality across PRs

## Configuration

Create `.code-audit.json` in your project:

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "maxTokensPerChunk": 100000,
  "parallel": true,
  "format": "text",
  "verbosity": "normal",
  "watch": false
}
```

Override with CLI flags:
```bash
# Different output formats
code-audit src/ --format json > results.json
code-audit src/ --format markdown > AUDIT.md
code-audit src/ --format html > audit.html

# Watch mode for continuous analysis
code-audit --watch src/

# Verbosity control
code-audit --quiet src/          # Minimal output
code-audit --verbose src/        # Detailed findings
code-audit --debug src/          # + API calls and timing

# Custom model
code-audit src/ --model claude-opus-4-6 --output report.md
```

### Shell Completions

Install completions for better CLI experience:

```bash
# Bash
code-audit completions bash > /usr/local/share/bash-completion/completions/code-audit

# Zsh
code-audit completions zsh > /usr/local/share/zsh/site-functions/_code-audit
```

## Supported Languages

- TypeScript / JavaScript
- Python
- Go
- Rust
- Java
- C / C++

More languages coming soon!

## Pricing

### CLI Tool
**Free** - You only pay for Claude API usage (~$0.01-0.10 per audit, depending on codebase size)

### Web Dashboard
- **Free**: 5 audits/month, 1 team member
- **Pro**: $39/month, unlimited audits, 1 team member
- **Team**: $249/month, unlimited audits, 5 team members

[See full pricing →](https://code-auditor.com/pricing)

## Documentation

- **[Development Guide](docs/DEVELOPMENT.md)** - Set up development environment
- **[Architecture](docs/ARCHITECTURE.md)** - How the multi-agent system works
- **[Deployment](docs/DEPLOYMENT.md)** - Deploy CLI binaries and web dashboard
- **[Contributing](CONTRIBUTING.md)** - Contribution guidelines

## Use Cases

**Pre-commit checks** - Catch issues before they hit your repository:
```bash
# .git/hooks/pre-commit
code-audit --changed-files
```

**PR reviews** - Automated quality feedback on pull requests via GitHub Action

**Onboarding** - Help new team members understand code quality standards:
```bash
code-audit legacy/ --output onboarding-guide.md
```

**Refactoring** - Measure quality improvements:
```bash
code-audit src/ --output before.md
# ... refactor ...
code-audit src/ --output after.md
diff before.md after.md
```

**CI/CD pipeline** - Fail builds on critical issues:
```bash
code-audit src/ || exit 1
```

## Example Output

```
AI Code Auditor Report
Target: src/
Overall Score: 7.8/10 ⭐⭐⭐⭐

Agent Breakdown:
✓ Correctness     8.5/10  (2 warnings, 0 critical)
✓ Security        9.2/10  (1 info, 0 critical)
⚠ Performance     6.8/10  (3 warnings, 1 critical)
✓ Maintainability 8.1/10  (2 warnings, 0 critical)
⚠ Edge Cases      6.5/10  (4 warnings, 0 critical)

Critical Issues:
🔴 Performance: O(n²) complexity in search function
   File: src/search.ts:42
   Fix: Use hash map for O(1) lookups

Warnings:
⚠️  Edge Cases: Missing null check for user input
   File: src/auth.ts:15
   Fix: Add validation before processing
```

## Requirements

- **CLI**: macOS 11+ or Linux (glibc 2.31+)
- **API Key**: Anthropic API key ([get one here](https://console.anthropic.com))
- **Web Dashboard**: Modern browser, GitHub account

## Community

- 💬 [GitHub Discussions](https://github.com/yourorg/ai-code-auditor/discussions) - Ask questions
- 🐛 [Issue Tracker](https://github.com/yourorg/ai-code-auditor/issues) - Report bugs
- 📢 [Twitter](https://twitter.com/codecauditor) - Updates and tips
- 📧 [Newsletter](https://code-auditor.com/newsletter) - Monthly quality insights

## License

MIT License - see [LICENSE](LICENSE) for details

## Acknowledgments

Powered by [Anthropic Claude](https://www.anthropic.com/claude) - the AI model behind the specialized agents.

---

**Ready to improve your code quality?**

```bash
# Install and try it now
brew install ai-code-auditor
code-audit src/
```

[Get Started →](https://code-auditor.com) | [Documentation →](docs/) | [GitHub →](https://github.com/yourorg/ai-code-auditor)
