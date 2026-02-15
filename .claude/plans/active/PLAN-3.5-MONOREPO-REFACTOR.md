# Implementation Plan: Monorepo Refactor with Turborepo

**Priority:** 🟢 MEDIUM - Architecture improvement, not blocking
**Estimated Time:** 8-12 hours
**Owner:** Engineering
**Branch:** `feature/monorepo-refactor`

## Overview

Refactor the codebase into a monorepo structure using Turborepo for efficient builds, shared code, and better scalability as the product grows.

**Current Problems:**
- Code duplication (types, API client logic)
- CLI and web dashboard don't share code
- GitHub Action duplicates CLI logic
- Hard to version shared packages
- No build caching or parallelization

**Target State:**
- Single monorepo with multiple apps and shared packages
- Turborepo build pipeline with caching
- Shared packages: core, types, api-client
- Clean separation of concerns
- 3-5x faster CI/CD builds

---

## Current vs. Target Structure

### Current Structure

```
ai-code-auditor/
├── src/                    # CLI source code
│   ├── agents/
│   ├── orchestrator.ts
│   └── cli.ts
├── web/                    # Next.js dashboard
│   ├── app/
│   ├── lib/
│   └── components/
├── action.yml              # GitHub Action (duplicates CLI)
├── package.json
└── tsconfig.json
```

**Problems:**
- `web/lib/api-client/` duplicates CLI API logic
- Types defined in both `src/agents/types.ts` and `web/app/api/`
- GitHub Action can't import from `src/` directly
- Each package builds independently (slow)

---

### Target Structure

```
ai-code-auditor/
├── apps/
│   ├── cli/                      # Bun CLI tool
│   │   ├── src/
│   │   │   ├── cli.ts           # Entry point
│   │   │   ├── discovery.ts
│   │   │   └── report/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── web/                      # Next.js dashboard
│   │   ├── app/
│   │   ├── lib/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── action/                   # GitHub Action (thin wrapper)
│       ├── src/
│       │   └── index.ts         # Uses @code-auditor/core
│       ├── action.yml
│       ├── package.json
│       └── tsconfig.json
│
├── packages/
│   ├── core/                     # Shared audit logic
│   │   ├── src/
│   │   │   ├── agents/          # All 5 agents
│   │   │   ├── orchestrator.ts
│   │   │   ├── chunker.ts
│   │   │   └── client.ts        # Anthropic API wrapper
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── types/                    # Shared TypeScript types
│   │   ├── src/
│   │   │   ├── audit.ts         # AuditReport, Finding, etc.
│   │   │   ├── agent.ts         # AgentDefinition, AgentResult
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api-client/               # Shared API client
│   │   ├── src/
│   │   │   ├── client.ts        # REST API client
│   │   │   ├── sdk.ts           # High-level SDK
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── config/                   # Shared configs
│       ├── eslint-config.js
│       ├── tsconfig.base.json
│       └── package.json
│
├── turbo.json                    # Turborepo pipeline config
├── package.json                  # Root workspace
└── README.md
```

**Benefits:**
- ✅ Single source of truth for types
- ✅ Shared audit logic across CLI/web/action
- ✅ API client can be published as standalone SDK
- ✅ Turborepo caches builds (3-5x faster CI/CD)
- ✅ Parallel builds across packages

---

## Task 1: Setup Turborepo (Wave 1, 3 hours)

### Step 1: Install Turborepo

```bash
cd /Users/nori/Projects/ai-code-auditor

# Install Turborepo
bun add -D turbo

# Initialize Turborepo
bunx turbo init
```

### Step 2: Create Root Workspace

Create root `package.json`:

```json
{
  "name": "ai-code-auditor-monorepo",
  "version": "1.0.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "build": "turbo build",
    "dev": "turbo dev",
    "test": "turbo test",
    "lint": "turbo lint",
    "clean": "turbo clean && rm -rf node_modules"
  },
  "devDependencies": {
    "turbo": "^2.0.0",
    "typescript": "^5.3.0"
  },
  "engines": {
    "node": ">=18.0.0"
  }
}
```

### Step 3: Configure Turborepo Pipeline

Create `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "build/**"]
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"]
    },
    "lint": {
      "outputs": []
    },
    "dev": {
      "cache": false,
      "persistent": true
    },
    "clean": {
      "cache": false
    }
  },
  "globalDependencies": [
    "tsconfig.json",
    ".env"
  ]
}
```

**What this does:**
- `"dependsOn": ["^build"]` - Build dependencies first
- `"outputs"` - Cache these directories
- `"persistent": true` - Keep dev servers running
- Global dependencies trigger cache invalidation

### Step 4: Create Directory Structure

```bash
# Create directories
mkdir -p apps/cli apps/web apps/action
mkdir -p packages/core packages/types packages/api-client packages/config

# Create placeholder package.json files
for dir in apps/cli apps/web apps/action packages/core packages/types packages/api-client packages/config; do
  echo '{"name": "placeholder"}' > $dir/package.json
done
```

**Acceptance Criteria:**
- [ ] Turborepo installed and configured
- [ ] Root workspace package.json created
- [ ] turbo.json pipeline configured
- [ ] Directory structure created
- [ ] `bun install` runs without errors

---

## Task 2: Extract Shared Packages (Wave 2, 4-6 hours)

### Step 1: Create `packages/types`

This is the foundation - all other packages depend on types.

**Create `packages/types/package.json`:**

```json
{
  "name": "@code-auditor/types",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Create `packages/types/tsconfig.json`:**

```json
{
  "extends": "../config/tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

**Migrate types from `src/agents/types.ts`:**

```typescript
// packages/types/src/audit.ts
export type Severity = "critical" | "warning" | "info"

export interface Finding {
  severity: Severity
  title: string
  description: string
  file: string
  line?: number
  suggestion?: string
}

export interface AuditReport {
  target: string
  overallScore: number
  agentResults: AgentResult[]
  criticalCount: number
  warningCount: number
  infoCount: number
  topRecommendations: string[]
  timestamp: string
  durationMs: number
}
```

```typescript
// packages/types/src/agent.ts
import { Finding } from './audit'

export interface AgentResult {
  agent: string
  score: number
  findings: Finding[]
  summary: string
  durationMs: number
}

export interface AgentDefinition {
  name: string
  weight: number
  systemPrompt: string
  userPromptTemplate: (files: FileContent[]) => string
  parseResponse: (raw: string) => AgentResult
}

export interface FileContent {
  path: string
  content: string
  language: string
}
```

```typescript
// packages/types/src/index.ts
export * from './audit'
export * from './agent'
```

---

### Step 2: Create `packages/core`

Contains all audit logic (agents, orchestrator, chunker).

**Create `packages/core/package.json`:**

```json
{
  "name": "@code-auditor/core",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@code-auditor/types": "workspace:*",
    "@anthropic-ai/sdk": "^0.27.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Migrate core logic:**

```bash
# Copy agents
cp -r src/agents packages/core/src/

# Copy orchestrator
cp src/orchestrator.ts packages/core/src/

# Copy chunker
cp src/chunker.ts packages/core/src/

# Copy client
cp src/client.ts packages/core/src/
```

**Update imports in `packages/core/src/**`:**

```typescript
// Before
import { AgentResult, Finding } from './types'

// After
import { AgentResult, Finding } from '@code-auditor/types'
```

**Create `packages/core/src/index.ts`:**

```typescript
export * from './agents'
export * from './orchestrator'
export * from './chunker'
export * from './client'
```

---

### Step 3: Create `packages/api-client`

Shared API client for communicating with web dashboard.

**Create `packages/api-client/package.json`:**

```json
{
  "name": "@code-auditor/api-client",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist"
  },
  "dependencies": {
    "@code-auditor/types": "workspace:*"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Create `packages/api-client/src/client.ts`:**

```typescript
import type { AuditReport } from '@code-auditor/types'

export interface ApiClientConfig {
  apiUrl: string
  apiKey: string
}

export class CodeAuditorClient {
  private config: ApiClientConfig

  constructor(config: ApiClientConfig) {
    this.config = config
  }

  async submitAudit(report: AuditReport): Promise<{ id: string; url: string }> {
    const response = await fetch(`${this.config.apiUrl}/api/cli/audit`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(report),
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`)
    }

    return response.json()
  }

  async getAudit(id: string): Promise<AuditReport> {
    const response = await fetch(`${this.config.apiUrl}/api/audits/${id}`, {
      headers: {
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
    })

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`)
    }

    return response.json()
  }
}
```

**Create `packages/api-client/src/index.ts`:**

```typescript
export * from './client'
```

---

### Step 4: Create `packages/config`

Shared configurations (TypeScript, ESLint).

**Create `packages/config/tsconfig.base.json`:**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

**Create `packages/config/package.json`:**

```json
{
  "name": "@code-auditor/config",
  "version": "1.0.0",
  "files": [
    "tsconfig.base.json"
  ]
}
```

**Acceptance Criteria:**
- [ ] `packages/types` built and exporting types
- [ ] `packages/core` built with agent logic
- [ ] `packages/api-client` created
- [ ] `packages/config` created with shared configs
- [ ] All imports updated to use workspace packages
- [ ] `bun run build` builds all packages in order

---

## Task 3: Migrate Apps (Wave 2 continued, 2 hours)

### Step 1: Migrate CLI to `apps/cli`

**Move files:**

```bash
# Move CLI source
mv src apps/cli/

# Move CLI-specific files
mv package.json apps/cli/package.json
mv tsconfig.json apps/cli/tsconfig.json
mv bun.lock apps/cli/bun.lock
```

**Update `apps/cli/package.json`:**

```json
{
  "name": "@code-auditor/cli",
  "version": "1.0.0",
  "bin": {
    "code-auditor": "./dist/cli.js"
  },
  "scripts": {
    "build": "bun build ./src/cli.ts --outdir ./dist --target bun",
    "dev": "bun run src/cli.ts",
    "test": "bun test"
  },
  "dependencies": {
    "@code-auditor/core": "workspace:*",
    "@code-auditor/types": "workspace:*",
    "@code-auditor/api-client": "workspace:*",
    "@anthropic-ai/sdk": "^0.27.0"
  },
  "devDependencies": {
    "typescript": "^5.3.0"
  }
}
```

**Update imports in `apps/cli/src/cli.ts`:**

```typescript
// Before
import { runAudit } from './orchestrator'
import { AuditReport } from './agents/types'

// After
import { runAudit } from '@code-auditor/core'
import type { AuditReport } from '@code-auditor/types'
import { CodeAuditorClient } from '@code-auditor/api-client'
```

**Remove duplicated code from `apps/cli/src/`:**

```bash
# Remove files now in packages/core
rm -rf apps/cli/src/agents
rm apps/cli/src/orchestrator.ts
rm apps/cli/src/chunker.ts
rm apps/cli/src/client.ts
```

---

### Step 2: Migrate Web to `apps/web`

**Move files:**

```bash
# Web is already in web/, just move it
mv web apps/web
```

**Update `apps/web/package.json`:**

```json
{
  "name": "@code-auditor/web",
  "version": "1.0.0",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "test": "vitest",
    "lint": "next lint"
  },
  "dependencies": {
    "@code-auditor/types": "workspace:*",
    "@code-auditor/api-client": "workspace:*",
    "next": "14.2.0",
    "react": "^18.3.0",
    "@clerk/nextjs": "^4.29.0",
    "stripe": "^14.0.0",
    "@upstash/redis": "^1.36.2",
    "@upstash/ratelimit": "^2.0.8"
  },
  "devDependencies": {
    "@code-auditor/config": "workspace:*",
    "typescript": "^5.3.0",
    "vitest": "^4.0.18"
  }
}
```

**Update imports in `apps/web/app/**`:**

```typescript
// Before
import { AuditReport, Finding } from '@/types/audit'

// After
import type { AuditReport, Finding } from '@code-auditor/types'
```

**Remove duplicated types:**

```bash
# Remove types now in packages/types
rm -rf apps/web/types
```

---

### Step 3: Create GitHub Action App

**Create `apps/action/package.json`:**

```json
{
  "name": "@code-auditor/action",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "build": "bun build src/index.ts --outdir dist --target node",
    "dev": "bun run src/index.ts"
  },
  "dependencies": {
    "@code-auditor/core": "workspace:*",
    "@code-auditor/types": "workspace:*",
    "@actions/core": "^1.10.1",
    "@actions/github": "^6.0.0"
  }
}
```

**Move action files:**

```bash
mv action.yml apps/action/
mv src/action.ts apps/action/src/index.ts
mv src/github apps/action/src/github
```

**Update `apps/action/src/index.ts`:**

```typescript
import { runAudit } from '@code-auditor/core'
import type { AuditReport } from '@code-auditor/types'
import * as core from '@actions/core'
import * as github from '@actions/github'

// Rest of GitHub Action logic
```

**Acceptance Criteria:**
- [ ] CLI moved to `apps/cli` and imports from packages
- [ ] Web moved to `apps/web` and imports from packages
- [ ] GitHub Action in `apps/action` uses shared core
- [ ] No code duplication across apps
- [ ] All apps build successfully

---

## Task 4: Build Pipeline Optimization (Wave 3, 1-2 hours)

### Configure Build Order

Update `turbo.json` with optimized pipeline:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"],
      "cache": true
    },
    "dev": {
      "dependsOn": ["^build"],
      "cache": false,
      "persistent": true
    },
    "test": {
      "dependsOn": ["build"],
      "outputs": ["coverage/**"],
      "cache": true
    },
    "lint": {
      "outputs": [],
      "cache": true
    }
  },
  "globalDependencies": [
    "tsconfig.json",
    ".env"
  ],
  "ui": "stream"
}
```

### Add Build Scripts to Each Package

**Pattern:**
```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "clean": "rm -rf dist",
    "test": "vitest"
  }
}
```

### Test Build Pipeline

```bash
# Clean everything
bun run clean

# Build all packages in dependency order
bun run build

# Verify build order
# Should build: types → core/api-client → cli/web/action
```

**Expected output:**
```
• Packages in scope: @code-auditor/types, @code-auditor/core, ...
• Running build in 6 packages
• @code-auditor/types:build: cache miss, executing...
• @code-auditor/core:build: cache miss, executing...
• @code-auditor/cli:build: cache miss, executing...
```

### Verify Caching

```bash
# Build again (should use cache)
bun run build

# Expected output:
# • @code-auditor/types:build: cache hit, replaying output...
```

**Acceptance Criteria:**
- [ ] `bun run build` builds all packages in correct order
- [ ] Second build uses Turbo cache (instant)
- [ ] `bun run dev` starts all dev servers
- [ ] `bun run test` runs all test suites
- [ ] Build times 3-5x faster with cache

---

## Task 5: Testing & Documentation (Wave 4, 2-3 hours)

### Update CI/CD

**Update `.github/workflows/test.yml`:**

```yaml
name: CI

on: [push, pull_request]

jobs:
  build-and-test:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: oven-sh/setup-bun@v1
        with:
          bun-version: latest

      - name: Install dependencies
        run: bun install

      - name: Build packages
        run: bun run build

      - name: Run tests
        run: bun run test

      - name: Lint
        run: bun run lint
```

### Update Documentation

**Update root `README.md`:**

```markdown
# AI Code Auditor

Multi-agent code quality auditor.

## Monorepo Structure

This is a Turborepo monorepo containing:

- **apps/cli** - Bun CLI tool
- **apps/web** - Next.js dashboard
- **apps/action** - GitHub Action
- **packages/core** - Shared audit logic
- **packages/types** - Shared TypeScript types
- **packages/api-client** - Shared API client
- **packages/config** - Shared configurations

## Development

```bash
# Install dependencies
bun install

# Build all packages
bun run build

# Run all dev servers
bun run dev

# Run tests
bun run test
```

## Working with Packages

```bash
# Add dependency to specific package
cd apps/cli
bun add lodash

# Add workspace dependency
cd apps/cli
bun add @code-auditor/types@workspace:*
```
```

**Create `apps/cli/README.md`:**

```markdown
# AI Code Auditor CLI

Command-line interface for AI Code Auditor.

## Development

```bash
# Run locally
bun run dev

# Build
bun run build

# Test
bun test
```

## Dependencies

This package uses shared workspace packages:
- `@code-auditor/core` - Audit logic
- `@code-auditor/types` - TypeScript types
- `@code-auditor/api-client` - API communication
```

**Create `packages/api-client/README.md`:**

```markdown
# @code-auditor/api-client

Official API client for AI Code Auditor.

## Installation

```bash
bun add @code-auditor/api-client
```

## Usage

```typescript
import { CodeAuditorClient } from '@code-auditor/api-client'

const client = new CodeAuditorClient({
  apiUrl: 'https://code-auditor.com',
  apiKey: process.env.CODE_AUDITOR_API_KEY!,
})

const result = await client.submitAudit(auditReport)
console.log(`View at: ${result.url}`)
```
```

### Verify End-to-End

**Test CLI:**
```bash
cd apps/cli
bun run dev /path/to/code
# Should run audit successfully
```

**Test Web:**
```bash
cd apps/web
bun run dev
# Visit http://localhost:3000
# Should load without errors
```

**Test Action:**
```bash
cd apps/action
bun run build
# Verify dist/index.js created
```

**Acceptance Criteria:**
- [ ] CI/CD updated for monorepo
- [ ] Root README documents structure
- [ ] Each package has README
- [ ] All apps run end-to-end
- [ ] No broken imports
- [ ] No build errors

---

## Migration Checklist

### Pre-Migration
- [ ] Commit all current work
- [ ] Create `feature/monorepo-refactor` branch
- [ ] Back up current working directory

### Wave 1: Setup
- [ ] Install Turborepo
- [ ] Create root workspace package.json
- [ ] Configure turbo.json
- [ ] Create directory structure
- [ ] Verify `bun install` works

### Wave 2: Packages
- [ ] Create `packages/types`
- [ ] Create `packages/core`
- [ ] Create `packages/api-client`
- [ ] Create `packages/config`
- [ ] Migrate types from src/
- [ ] Migrate agents from src/
- [ ] Update all imports
- [ ] Build packages successfully

### Wave 3: Apps
- [ ] Migrate CLI to `apps/cli`
- [ ] Migrate web to `apps/web`
- [ ] Create `apps/action`
- [ ] Update imports in all apps
- [ ] Remove duplicated code
- [ ] Build all apps successfully

### Wave 4: Optimization
- [ ] Configure Turbo cache
- [ ] Test build pipeline
- [ ] Verify cache hits
- [ ] Test parallel builds

### Wave 5: Documentation
- [ ] Update CI/CD workflows
- [ ] Update root README
- [ ] Add package READMEs
- [ ] Test end-to-end functionality

### Post-Migration
- [ ] Run full test suite
- [ ] Verify CLI still works
- [ ] Verify web dashboard loads
- [ ] Test GitHub Action builds
- [ ] Create PR for review

---

## Success Metrics

**Before Monorepo:**
- Build time: ~2 minutes (sequential)
- Code duplication: 30-40% (types, API client)
- Hard to share code between CLI/web
- GitHub Action can't import from CLI

**After Monorepo:**
- Build time: ~25 seconds (parallel + cache)
- Code duplication: 0% (shared packages)
- Clean imports: `@code-auditor/core`
- Unified type system across stack
- API client publishable as standalone package

---

## Future Enhancements (Not in This Plan)

- Publish `@code-auditor/api-client` to npm
- Add `packages/ui` for shared React components
- Add `packages/eslint-config` for shared linting
- Set up Changesets for versioning
- Add `packages/database` for shared Prisma schema

---

**Total Time:** 8-12 hours
**Branch:** `feature/monorepo-refactor`
**Merge After:** PLAN-3 (Positioning & Pricing) complete
**Before:** PLAN-4 (Marketing & GTM launch)
