# Architecture

AI Code Auditor architecture and design decisions.

## Overview

AI Code Auditor is a **multi-agent system** that analyzes code quality across five specialized dimensions. Each agent is an independent AI specialist that analyzes code in parallel, then results are synthesized into a comprehensive quality report.

## Multi-Agent System

### Agent Architecture

Each agent implements the `AgentDefinition` interface:

```typescript
interface AgentDefinition {
  name: string                                    // e.g., "correctness"
  weight: number                                  // Contribution to overall score
  systemPrompt: string                            // Agent's specialized instructions
  userPromptTemplate: (files: FileContent[]) => string
  parseResponse: (raw: string) => AgentResult
}
```

### The Five Agents

| Agent | Weight | Focus Areas |
|-------|--------|-------------|
| **Correctness** | 25% | Logic errors, type safety, null handling, API usage |
| **Security** | 25% | SQL injection, XSS, auth issues, crypto weaknesses |
| **Performance** | 15% | Algorithmic complexity, memory leaks, DB queries |
| **Maintainability** | 20% | Code complexity, documentation, error handling |
| **Edge Cases** | 15% | Boundary conditions, race conditions, rare failures |

**Weight validation**: On module load, the system validates that agent weights sum to exactly 1.0 (within floating point tolerance).

### Orchestration Flow

```
User Input (path)
      ↓
File Discovery (glob patterns, .gitignore)
      ↓
Chunking (split by token limit)
      ↓
┌─────────────────────────────────────┐
│   Parallel Agent Execution          │
│   (Promise.allSettled)               │
├───────┬────────┬────────┬────────┬──┤
│ Corr  │  Sec   │  Perf  │  Main  │EC│
└───┬───┴───┬────┴────┬───┴────┬───┴──┘
    │       │         │        │
    └───────┴─────────┴────────┘
              ↓
        AgentResult[]
              ↓
   Calculate Weighted Score
              ↓
    Synthesize Report
              ↓
┌─────────────┬──────────────┬──────────┐
│  Terminal   │  Markdown    │Dashboard │
│  Output     │  Export      │  Sync    │
└─────────────┴──────────────┴──────────┘
```

### Resilient Execution

**Key decision**: Use `Promise.allSettled` instead of `Promise.all`

This ensures that if one agent fails, others continue executing. Failed agents return a score of 0 with error findings, rather than aborting the entire audit.

```typescript
const results = await Promise.allSettled(
  agents.map(agent => runAgent(agent, files, options))
)
```

### Agent Communication

Agents do **NOT** communicate with each other. This design choice:
- Prevents cascading failures
- Enables true parallel execution
- Simplifies testing and debugging
- Maintains agent specialization

Each agent receives:
- **System prompt**: Specialized instructions for their domain
- **User prompt**: Code files formatted with line numbers
- **No context**: From other agents or previous runs

## Code Discovery

### Platform-Specific Implementations

The system supports both Bun and Node.js runtimes:

**Bun (CLI)** - `discovery.ts`:
```typescript
import { Glob } from "bun"
const files = await Bun.file(path).text()
```

**Node.js (GitHub Action)** - `discovery-node.ts`:
```typescript
import { glob } from "glob"
const files = await fs.readFile(path, 'utf-8')
```

### Discovery Process

1. **Pattern matching**: Uses glob patterns to find code files
2. **Gitignore respect**: Excludes files matching `.gitignore` patterns
3. **Size filtering**: Skips very large files (>1MB by default)
4. **Language detection**: Identifies programming language by extension

Supported languages: TypeScript, JavaScript, Python, Go, Rust, Java, C/C++

## Chunking Strategy

For large codebases that exceed token limits:

1. **Calculate total tokens**: Sum of all file contents
2. **Split if needed**: If total > maxTokensPerChunk, create chunks
3. **Chunk by file**: Never split individual files across chunks
4. **Process sequentially**: Run agents on each chunk, then merge results

**Current limitation**: Agents analyze each chunk independently. Cross-file issues may be missed in chunked audits.

## Scoring System

### Individual Agent Scores

Each agent returns a score from 0-10:
- **10**: Perfect, no issues found
- **7-9**: Minor issues, good overall quality
- **4-6**: Moderate issues, needs improvement
- **1-3**: Significant issues, requires attention
- **0**: Critical issues or agent failure

### Overall Score Calculation

Weighted average across all agents:

```typescript
overallScore = sum(agentScore * agentWeight) / sum(agentWeights)
```

Example:
```
Correctness:     8.5 × 0.25 = 2.125
Security:        6.0 × 0.25 = 1.500
Performance:     7.8 × 0.15 = 1.170
Maintainability: 8.2 × 0.20 = 1.640
Edge Cases:      5.9 × 0.15 = 0.885
                        ─────────
Overall Score:             7.32
```

## Report Generation

### Terminal Output

Rich, color-coded terminal output using ANSI escape codes:
- **Scores**: Color-coded by threshold (red <5, yellow 5-7, green >7)
- **Findings**: Grouped by agent, sorted by severity
- **Summary**: Overall score with visual rating (stars/emoji)

### Markdown Export

Generates structured markdown reports:
- Agent breakdown table
- Detailed findings sections
- Code snippets with line numbers
- Actionable suggestions

### Dashboard Sync

Optional integration with web dashboard:
1. User runs `code-audit login` to save API key
2. CLI includes API key in `Authorization` header
3. POST to `/api/cli/audit` with results
4. Dashboard stores audit + findings in database
5. CLI prints dashboard URL for viewing

## Web Dashboard Architecture

### Stack

- **Framework**: Next.js 14 App Router (React Server Components)
- **Database**: PostgreSQL via Prisma ORM
- **Auth**: Clerk (GitHub OAuth + email)
- **Payments**: Stripe (subscription-based)
- **Rate Limiting**: Upstash Redis

### Data Model

```
User ──< TeamMember >── Team
                         ├──< Audit
                         │     └──< Finding
                         └──< ApiKey
```

**Key relationships**:
- Users can belong to multiple teams (many-to-many via TeamMember)
- Teams own audits and API keys
- Audits contain multiple findings (one-to-many)
- Cascade deletes: Team deletion removes all related data

### API Security

**Rate Limiting**: All public endpoints use Upstash Redis
- Webhooks: 100 requests/minute per IP
- Audits: 10 requests/minute per API key
- Key operations: 5 requests/minute per user

**Authentication**:
- Dashboard: Clerk middleware on all routes
- CLI API: bcrypt-hashed API keys with constant-time comparison
- Webhooks: Signature verification (Svix for Clerk, Stripe SDK)

### Server Components by Default

Next.js App Router defaults to Server Components:
- Database queries run on server (no API routes needed)
- Secrets stay server-side
- Add `"use client"` only when needed (event handlers, hooks, browser APIs)

## GitHub Action

The Action is a wrapper around the core audit engine:

1. **Checkout code**: Uses `actions/checkout@v4`
2. **Install Node.js**: Action runs in Node environment (not Bun)
3. **Run audit**: Executes core audit logic via `discovery-node.ts`
4. **Comment on PR**: Posts results as GitHub PR comment
5. **Optional failure**: Can fail workflow on critical findings

**Distribution**: The action is distributed via `dist/action.js` (bundled with dependencies)

## Configuration

### User Configuration (`.code-audit.json`)

```json
{
  "model": "claude-sonnet-4-5-20250929",
  "maxTokensPerChunk": 100000,
  "parallel": true
}
```

Loaded via config module, merged with CLI flags, validated on startup.

### System Configuration

**Agent weights** - Hardcoded in agent definitions, validated on load
**Plan limits** - Stored in `apps/web/lib/stripe/config.ts`:
```typescript
PLAN_LIMITS = {
  FREE: { auditsPerMonth: 5, teamMembers: 1 },
  PRO: { auditsPerMonth: -1, teamMembers: 1 },
  TEAM: { auditsPerMonth: -1, teamMembers: 5 }
}
```

## Design Decisions

### Why Multi-Agent?

**Specialization**: Each agent focuses on one quality dimension, leading to deeper, more accurate analysis than a single generalist agent.

**Parallelization**: Independent agents run simultaneously, reducing total audit time.

**Resilience**: Failed agents don't block other agents from completing.

**Extensibility**: New agents can be added without modifying existing ones (weight rebalancing required).

### Why Turborepo?

**Caching**: Rebuild only changed packages, dramatically faster iteration.

**Task orchestration**: Automatically builds dependencies in correct order.

**Monorepo benefits**: Share code between CLI, web, and action without npm publishing.

### Why Bun for CLI?

**Performance**: Faster startup and execution than Node.js.

**Native APIs**: Built-in glob, file watching, bundling.

**Single binary**: Compile to standalone executable for distribution.

**Developer experience**: Fast install, test runner, bundler all included.

### Why Separate discovery.ts files?

**Platform compatibility**: Bun has native APIs (`Bun.file()`, `Glob from "bun"`) that don't exist in Node.js.

**GitHub Actions requirement**: Actions run in Node.js environment, can't use Bun-specific code.

**Solution**: Maintain two implementations, exclude Bun version from TypeScript compilation for Action builds.

## Performance Characteristics

**Typical audit** (small project, <50 files):
- Discovery: <100ms
- Agent execution: 5-15s (parallel)
- Report generation: <100ms
- **Total**: ~6-15 seconds

**Large project** (500+ files):
- Discovery: 200-500ms
- Chunking: 100-200ms
- Agent execution: 30-60s (per chunk)
- Report synthesis: 200-500ms
- **Total**: 1-3 minutes (depending on chunks)

**Bottleneck**: LLM API calls dominate execution time. Parallelization provides ~5x speedup over sequential execution.

## Future Considerations

**Potential improvements**:
- Cross-chunk analysis for better context awareness
- Caching of repeated code blocks across audits
- Incremental analysis (only changed files)
- Agent communication for complex cross-cutting concerns
- Custom agent definitions via configuration

**Limitations**:
- No static analysis (relies solely on LLM)
- Token limits constrain maximum file size
- Chunked audits may miss cross-file issues
- Cost scales with codebase size
