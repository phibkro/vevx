# AI Code Auditor

Multi-agent AI code quality analysis tool powered by Claude. Get comprehensive, actionable feedback across 5 specialized dimensions: correctness, security, performance, maintainability, and edge cases.

## Quick Start

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Run CLI audit
cd apps/cli && bun run dev src/

# Start web dashboard
cd apps/web && bun run dev
```

## Project Structure

This is a **Turborepo monorepo** with multiple packages:

```
ai-code-auditor/
├── apps/
│   ├── cli/              # CLI tool for code auditing
│   ├── web/              # Next.js dashboard (team collaboration)
│   └── action/           # GitHub Action
├── packages/
│   ├── core/             # Shared audit logic (agents, orchestrator)
│   ├── types/            # Shared TypeScript types
│   ├── api-client/       # Dashboard API client
│   └── config/           # Shared TS config
└── .claude/
    └── plans/            # Project planning documents
```

## Features

### CLI Tool
- **Multi-agent analysis** - 5 specialized agents analyze code in parallel
- **Weighted scoring** - Overall quality score based on configurable weights
- **Prioritized findings** - Critical issues highlighted first
- **Rich terminal output** - Color-coded, scannable reports
- **Markdown export** - Save reports for documentation and PRs
- **Language support** - TypeScript, JavaScript, Python, Go, Rust, Java, C/C++

### Web Dashboard
- **Team collaboration** - Share audit results across your team
- **Historical tracking** - Track quality trends over time
- **Automated syncing** - CLI results automatically sync to dashboard
- **Team management** - Role-based access control
- **API key management** - Secure CLI authentication

See [apps/web/README.md](apps/web/README.md) for dashboard setup.

### GitHub Action
- **Automatic PR comments** with quality reports
- **Changed files detection** - Only audits PR diff
- **Workflow failure** on critical issues (optional)

## Development

### Prerequisites

- [Bun](https://bun.sh/) 1.0+
- Node.js 18+ (for deployment compatibility)
- PostgreSQL (for web dashboard)

### Setup

```bash
# Clone repository
git clone https://github.com/yourusername/ai-code-auditor.git
cd ai-code-auditor

# Install dependencies (all packages)
bun install

# Set up environment variables
cp apps/web/.env.example apps/web/.env
# Edit apps/web/.env with your credentials

# Generate Prisma client
cd apps/web && bun run db:generate

# Build all packages
cd ../.. && bun run build
```

### Common Tasks

```bash
# Build all packages
bun run build

# Build specific package
cd apps/cli && bun run build
cd apps/web && bun run build

# Run CLI in development
cd apps/cli && bun run dev <path>

# Run web dashboard in development
cd apps/web && bun run dev

# Run tests
bun run test

# Run linter
bun run lint

# Clean all build artifacts
bun run clean
```

### Package Dependencies

```
┌─────────┐
│   CLI   │──┐
└─────────┘  │
             ├──> core ──> types
┌─────────┐  │
│   Web   │──┤
└─────────┘  │
             └──> api-client ──> types
┌─────────┐
│ Action  │──> core ──> types
└─────────┘
```

## How It Works

AI Code Auditor uses a **multi-agent architecture** with 5 specialized agents:

### 1. Correctness (25%)
Logic errors, type safety, null handling, API usage correctness

### 2. Security (25%)
SQL injection, XSS, auth issues, data exposure, crypto weaknesses

### 3. Performance (15%)
Algorithmic complexity, memory leaks, DB query efficiency, caching

### 4. Maintainability (20%)
Code complexity, documentation, error handling, test coverage

### 5. Edge Cases (15%)
Boundary conditions, race conditions, resource exhaustion, rare failures

Each agent analyzes code independently and returns a score (0-10) with detailed findings. The **overall score** is a weighted average.

## CLI Usage

```bash
# Audit a file
code-audit src/main.ts

# Audit a directory
code-audit src/

# Save report to file
code-audit src/ --output report.md

# Use different model
code-audit src/ --model claude-opus-4-6

# Dashboard integration
code-audit login              # Login once
code-audit src/               # Results auto-sync
code-audit logout             # Logout
```

### Configuration

Create `.code-audit.json` in your project:

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "maxTokensPerChunk": 100000,
  "parallel": true
}
```

## Web Dashboard

The Next.js dashboard provides team collaboration features:

- **Authentication** - Clerk (GitHub OAuth + email)
- **Database** - PostgreSQL via Prisma
- **Payments** - Stripe (Free/Pro/Team tiers)
- **Deployment** - Vercel

Setup instructions: [apps/web/README.md](apps/web/README.md)

## GitHub Action

Add to `.github/workflows/code-audit.yml`:

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

## Environment Variables

### CLI (`apps/cli`)
```bash
ANTHROPIC_API_KEY=sk-ant-...        # Required for analysis
CODE_AUDITOR_API_KEY=...            # Optional for dashboard sync
```

### Web Dashboard (`apps/web`)
```bash
# Database
DATABASE_URL=postgresql://...

# Authentication (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
CLERK_WEBHOOK_SECRET=whsec_...

# Payments (Stripe)
STRIPE_SECRET_KEY=sk_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_PRICE_ID=price_...
STRIPE_TEAM_PRICE_ID=price_...

# Rate Limiting (Upstash Redis)
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
```

See `apps/web/.env.example` for complete list.

## Deployment

### CLI Binary Distribution

```bash
cd apps/cli

# Build for specific platform
bun run build:darwin-arm64   # macOS Apple Silicon
bun run build:darwin-x64     # macOS Intel
bun run build:linux-x64      # Linux x86_64
bun run build:linux-arm64    # Linux ARM64

# Build all platforms
bun run build:binaries
```

Binaries output to `apps/cli/dist/`.

### Web Dashboard (Vercel)

```bash
cd apps/web

# Deploy to Vercel
vercel

# Or connect your GitHub repo to Vercel for automatic deployments
```

The monorepo is configured with `vercel.json` at the root for proper build settings.

## Testing

```bash
# Run all tests
bun run test

# Web dashboard tests
cd apps/web
bun test                    # Unit tests (Vitest)
bun run test:e2e           # E2E tests (Playwright)
bun run test:coverage      # Coverage report
```

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Run tests (`bun run test`)
5. Commit (`git commit -m 'feat: add amazing feature'`)
6. Push (`git push origin feature/amazing-feature`)
7. Open a Pull Request

See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines.

## Project Plans

Project planning documents are in `.claude/plans/`:
- **active/** - Currently in progress
- **archive/** - Completed plans
- **backlog/** - Prioritized future work

## License

MIT License - see [LICENSE](LICENSE) for details.

## Acknowledgments

- [Anthropic Claude](https://www.anthropic.com/claude) - AI model powering analysis
- [Bun](https://bun.sh/) - Fast JavaScript runtime and build tool
- [Turborepo](https://turbo.build/) - High-performance build system
- [Next.js](https://nextjs.org/) - React framework for web dashboard
- [Prisma](https://www.prisma.io/) - Database ORM

---

**Note:** This tool provides AI-generated insights. Always apply human judgment and verify critical findings.
