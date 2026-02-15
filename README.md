# AI Code Audit

A multi-agent AI code quality analysis tool powered by Claude. Get comprehensive, actionable feedback on your code across 5 specialized dimensions: correctness, security, performance, maintainability, and edge case handling.

## Why AI Code Auditor?

Traditional static analysis tools excel at syntax and basic patterns, but struggle with:
- **Context-aware security analysis** - Understanding business logic vulnerabilities
- **Performance bottleneck detection** - Identifying algorithmic inefficiencies
- **Maintainability assessment** - Evaluating long-term code quality
- **Edge case discovery** - Finding rare but critical failure modes

AI Code Audit uses **5 parallel specialized agents** to provide deep, context-aware analysis that goes beyond what traditional tools offer.

## Features

### CLI Tool
- **Multi-agent analysis** - 5 specialized agents analyze code in parallel
- **Weighted scoring** - Overall quality score based on configurable agent weights
- **Prioritized findings** - Critical issues highlighted first
- **Rich terminal output** - Color-coded, scannable reports
- **Markdown export** - Save reports for documentation and PRs
- **Chunk-based processing** - Handle large codebases efficiently
- **Language support** - TypeScript, JavaScript, Python, Go, Rust, Java, C/C++
- **Binary distribution** - No runtime dependencies, works without Bun
- **Easy installation** - One-line install script for macOS and Linux

### Web Dashboard (NEW!)
- **Team collaboration** - Share audit results across your team
- **Historical tracking** - Track quality trends over time
- **Automated syncing** - CLI results automatically sync to dashboard
- **Team management** - Role-based access control
- **Usage analytics** - Monitor team audit activity
- **API key management** - Secure CLI authentication

See [web/README.md](web/README.md) for dashboard setup instructions.

## Installation

### Option 1: Install Binary (Recommended)

Download and install the pre-built binary for your platform:

```bash
curl -fsSL https://raw.githubusercontent.com/yourusername/ai-code-audit/main/install.sh | bash
```

This will:
- Auto-detect your OS and architecture
- Download the appropriate binary
- Install to `~/.code-audit/bin/`
- Guide you through adding it to your PATH

### Option 2: Build from Source

If you have Bun installed:

```bash
# Clone the repository
git clone https://github.com/yourusername/ai-code-audit.git
cd ai-code-audit

# Install dependencies
bun install

# Build binary for your platform
bun run build:darwin-arm64   # macOS Apple Silicon
bun run build:darwin-x64     # macOS Intel
bun run build:linux-x64      # Linux x86_64
bun run build:linux-arm64    # Linux ARM64
bun run build:all            # All platforms

# Binary will be in dist/
./dist/code-audit-darwin-arm64 --version
```

### Option 3: Run from Source

```bash
git clone https://github.com/yourusername/ai-code-audit.git
cd ai-code-audit
bun install
```

## Setup

### 1. Get an Anthropic API Key

Sign up at [console.anthropic.com](https://console.anthropic.com/) and create an API key.

Set it as an environment variable:

```bash
export ANTHROPIC_API_KEY='sk-ant-...'
```

Or add it to your shell profile (`.bashrc`, `.zshrc`, etc.):

```bash
echo 'export ANTHROPIC_API_KEY="sk-ant-..."' >> ~/.zshrc
source ~/.zshrc
```

### 2. (Optional) Login to Dashboard

If you want to sync audit results to the web dashboard:

```bash
code-audit login
```

This will prompt you for your dashboard API key and save it locally.

## Usage

### Basic Usage

Using installed binary:

```bash
# Show version
code-audit --version

# Show help
code-audit --help

# Audit a single file
code-audit src/main.ts

# Audit an entire directory
code-audit src/

# Self-audit (analyze the auditor's own code)
code-audit src/
```

Running from source:

```bash
# Audit a file or directory
bun run src/cli.ts src/

# Show help
bun run src/cli.ts --help
```

### Dashboard Integration

```bash
# Login once
code-audit login

# Run audits - results automatically sync to dashboard
code-audit src/

# Logout
code-audit logout
```

### Save Report to File

```bash
# Save markdown report
code-audit src/ --output report.md

# Use in CI/CD pipeline
code-audit src/ --output audit-report-$(date +%Y%m%d).md
```

### Advanced Options

```bash
# Use a different Claude model
code-audit src/ --model claude-opus-4-6

# Adjust token limit per chunk
code-audit src/ --max-tokens 150000

# Disable parallel processing (sequential)
code-audit src/ --no-parallel

# Show version
code-audit --version

# Show help
code-audit --help
```

## Configuration

Create a `.code-audit.json` file in your project directory for persistent settings:

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "maxTokensPerChunk": 100000,
  "parallel": true
}
```

CLI arguments override configuration file settings.

## How It Works

AI Code Auditor uses a **multi-agent architecture** with 5 specialized agents running in parallel:

### 1. Correctness Agent (25% weight)
- Logic errors and incorrect algorithms
- Type safety violations
- Null/undefined handling
- Off-by-one errors
- API usage correctness

### 2. Security Agent (25% weight)
- SQL injection and XSS vulnerabilities
- Authentication and authorization issues
- Sensitive data exposure
- Input validation problems
- Cryptographic weaknesses

### 3. Performance Agent (15% weight)
- Algorithmic complexity issues
- Memory leaks and excessive allocations
- Database query inefficiencies
- Unnecessary computation
- Caching opportunities

### 4. Maintainability Agent (20% weight)
- Code complexity and readability
- Documentation quality
- Error handling patterns
- Test coverage gaps
- Code duplication

### 5. Edge Cases Agent (15% weight)
- Boundary condition handling
- Rare failure modes
- Concurrent access issues
- Resource exhaustion scenarios
- Input validation edge cases

Each agent:
1. Receives the code with line numbers
2. Analyzes it from their specialized perspective
3. Returns a score (0-10) and detailed findings
4. Findings are prioritized by severity (critical, warning, info)

The **overall score** is a weighted average across all agents, giving you a single quality metric while preserving individual dimension insights.

## Example Output

### Terminal Output

```
╔══════════════════════════════════════════════════════════╗
║           AI Code Auditor - Multi-Agent Report           ║
╚══════════════════════════════════════════════════════════╝

Target: src/auth.ts
Overall Score: 7.2/10 ⭐⭐⭐⭐

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Agent Breakdown:

✓ correctness     8.5/10  (weight: 25%)  [142ms]
⚠ security        6.0/10  (weight: 25%)  [156ms]
✓ performance     7.8/10  (weight: 15%)  [134ms]
✓ maintainability 8.2/10  (weight: 20%)  [148ms]
⚠ edge-cases      5.9/10  (weight: 15%)  [151ms]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Findings Summary:

🔴 Critical: 2
🟡 Warnings: 5
🔵 Info: 3

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 Top Recommendations:

1. SQL injection vulnerability in login query
   → src/auth.ts:42
   Use parameterized queries instead of string concatenation
```

### Markdown Report

Reports saved with `--output` are formatted as clean markdown, perfect for:
- Pull request comments
- Documentation
- Issue tracking
- Code review records
- CI/CD artifacts

## Success Criteria

This project meets the following Wave 3 success criteria:

- ✅ Terminal output is colored, scannable, shows overall score
- ✅ Critical findings highlighted in red
- ✅ Markdown export (if --output flag) matches terminal content
- ✅ Self-audit works: `bun run src/cli.ts src/` produces valid report
- ✅ README provides clear usage instructions

## Development

### Project Structure

```
ai-code-audit/
├── src/
│   ├── agents/           # 5 specialized analysis agents
│   │   ├── correctness.ts
│   │   ├── security.ts
│   │   ├── performance.ts
│   │   ├── maintainability.ts
│   │   ├── edge-cases.ts
│   │   ├── types.ts
│   │   └── index.ts
│   ├── report/           # Report generation system
│   │   ├── synthesizer.ts  # Aggregate results
│   │   ├── terminal.ts     # Colored terminal output
│   │   └── markdown.ts     # Markdown export
│   ├── cli.ts            # CLI entry point
│   ├── config.ts         # Configuration management
│   ├── discovery.ts      # File discovery
│   ├── chunker.ts        # Large codebase chunking
│   ├── client.ts         # Anthropic API client
│   └── orchestrator.ts   # Multi-agent orchestration
├── .code-audit.json    # Optional configuration
├── package.json
└── README.md
```

### Running Tests

```bash
# Run the test suite
bun test

# Self-audit (best integration test)
bun run src/cli.ts src/
```

### Adding New Agents

To add a new analysis dimension:

1. Create a new agent file in `src/agents/`
2. Define the agent with `AgentDefinition` interface
3. Add it to `src/agents/index.ts`
4. Adjust weights to ensure they sum to 1.0

## Limitations

- **API costs** - Each audit makes 5 parallel API calls (one per agent)
- **Token limits** - Very large files may need chunking (automatic)
- **Language coverage** - Best results with TypeScript/JavaScript, good with others
- **Context window** - Currently analyzes files as single batch (chunk support planned)

## GitHub Action

Automatically audit code quality on every pull request! Add AI Code Auditor to your GitHub workflow for continuous quality monitoring.

### Quick Setup

Add to your repo at `.github/workflows/code-audit.yml`:

```yaml
name: Code Quality Audit

on: [pull_request]

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

Add your `ANTHROPIC_API_KEY` as a repository secret, and you're done!

### Features

- Automatic PR comments with quality reports
- Deduplication (updates existing comments)
- Changed files detection (only audits PR diff)
- Optional workflow failure on critical issues
- Minimum score enforcement

### Free Tier

**Public repositories get unlimited free audits** with attribution.

**Private repositories** require a Pro subscription ($29/mo).

### Full Documentation

See [GITHUB_ACTION.md](./GITHUB_ACTION.md) for complete documentation, examples, and configuration options.

## Roadmap

- [x] Multi-agent CLI tool
- [x] GitHub Actions integration
- [ ] Per-chunk analysis for large codebases
- [ ] Custom agent configurations
- [ ] VS Code extension
- [ ] Caching and incremental analysis
- [ ] Custom rule definitions
- [ ] Team-wide configuration sharing

## Contributing

Contributions welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run self-audit: `bun run src/cli.ts src/`
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Acknowledgments

Built with:
- [Anthropic Claude](https://www.anthropic.com/claude) - AI model
- [Bun](https://bun.sh/) - Fast JavaScript runtime
- [Anthropic SDK](https://github.com/anthropics/anthropic-sdk-typescript) - API client

---

**Note:** This tool provides AI-generated insights. Always apply human judgment and verify critical findings before making changes.
