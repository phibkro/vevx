# Implementation Plan: Incremental Analysis

**Status:** 📋 PLANNED
**Priority:** 🔴 CRITICAL - Makes daily usage viable
**Scope:** packages/core + apps/cli
**Estimated Time:** 16-20 hours (2 weeks)
**Branch:** `feature/incremental-analysis`

## Overview

Add incremental analysis to make audits 10x faster by caching results for unchanged files. This transforms the tool from "occasional deep analysis" to "run on every commit".

**Current State:**
- Full codebase audit: 30-60 seconds
- Re-analyzes all files every time
- Too slow for CI/CD workflows
- Developers won't run it frequently

**Target State:**
- Incremental audit: 3-5 seconds
- Only analyzes changed files
- Cache hit rate >95% on typical workflows
- Fast enough to run on every commit

**Impact:**
- **Startups:** Can use in CI/CD without slowing down deployment
- **Developers:** Get instant feedback on changes
- **Business:** 10x more usage → 10x more value → stickier product

---

## User Stories

### Story 1: Fast PR Feedback

**As a** developer
**I want** code quality feedback in <5 seconds
**So that** I can iterate quickly without context switching

**Acceptance Criteria:**
- [ ] First audit caches all file results
- [ ] Subsequent audits only analyze changed files
- [ ] Cache invalidated when file content changes
- [ ] <5s audit time for typical PR (2-5 files changed)

**Story Points:** 5

---

### Story 2: Cache Management

**As a** developer
**I want** the cache to be automatic and invisible
**So that** I don't have to think about it

**Acceptance Criteria:**
- [ ] Cache stored in `.code-audit-cache/` (gitignored)
- [ ] Automatic cleanup of old cache entries (>30 days)
- [ ] Cache size limits (max 100MB)
- [ ] Manual cache clear: `code-audit --clear-cache`

**Story Points:** 3

---

### Story 3: CI/CD Integration

**As a** CI/CD engineer
**I want** incremental audits in GitHub Actions
**So that** PRs get fast quality checks

**Acceptance Criteria:**
- [ ] Cache persists between CI runs
- [ ] Works with GitHub Actions cache
- [ ] Fallback to full audit if cache missing
- [ ] Clear documentation for CI setup

**Story Points:** 3

---

## Technical Design

### Architecture

```
┌─────────────────────────────────────────────┐
│  CLI: code-audit src/ --incremental         │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Incremental Analyzer                       │
│  1. Hash all files (SHA-256)                │
│  2. Load cache from disk                    │
│  3. Identify changed files                  │
│  4. Audit only changed files                │
│  5. Merge with cached results               │
│  6. Update cache                            │
└─────────────────┬───────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────┐
│  Cache Store (.code-audit-cache/)           │
│  - index.json (file hash → cache entry)     │
│  - results/ (individual result files)       │
│  - metadata.json (cache stats)              │
└─────────────────────────────────────────────┘
```

### Data Structures

```typescript
// packages/core/src/incremental/types.ts

interface FileHash {
  path: string
  hash: string        // SHA-256 of file content
  size: number        // File size in bytes
  lastModified: number // Timestamp
}

interface CacheEntry {
  fileHash: string
  agentResults: AgentResult[]  // Results from all 5 agents
  timestamp: number             // When cached
  cliVersion: string            // Version that created cache
  modelVersion: string          // Claude model used
}

interface CacheIndex {
  version: string               // Cache format version
  entries: Map<string, CacheEntry>
  stats: {
    totalEntries: number
    totalSize: number          // Bytes
    oldestEntry: number        // Timestamp
    newestEntry: number        // Timestamp
  }
}

interface IncrementalResult {
  results: AgentResult[]
  stats: {
    totalFiles: number
    cachedFiles: number
    analyzedFiles: number
    cacheHitRate: number       // Percentage
    timeSaved: number          // Seconds
  }
}
```

### Cache Storage Format

```
.code-audit-cache/
├── index.json              # Main index
├── metadata.json           # Cache metadata
└── results/
    ├── abc123.json        # SHA-256 hash → results
    ├── def456.json
    └── ...
```

**index.json:**
```json
{
  "version": "1.0",
  "entries": {
    "src/auth.ts": {
      "fileHash": "abc123...",
      "resultPath": "results/abc123.json",
      "timestamp": 1708041600000,
      "cliVersion": "1.0.0",
      "modelVersion": "claude-sonnet-4-5-20250929"
    }
  },
  "stats": {
    "totalEntries": 247,
    "totalSize": 12458964,
    "oldestEntry": 1705363200000,
    "newestEntry": 1708041600000
  }
}
```

**results/abc123.json:**
```json
{
  "fileHash": "abc123...",
  "filePath": "src/auth.ts",
  "agentResults": [
    {
      "agent": "correctness",
      "score": 8.5,
      "summary": "...",
      "findings": [...]
    }
  ],
  "timestamp": 1708041600000,
  "metadata": {
    "cliVersion": "1.0.0",
    "modelVersion": "claude-sonnet-4-5-20250929"
  }
}
```

---

## Implementation Waves

### Wave 1: Core Incremental Logic (6-8h)

**Files to create:**
- `packages/core/src/incremental/types.ts` - Type definitions
- `packages/core/src/incremental/hasher.ts` - File hashing
- `packages/core/src/incremental/cache.ts` - Cache read/write
- `packages/core/src/incremental/analyzer.ts` - Main logic
- `packages/core/src/incremental/index.ts` - Public API

**Implementation:**

```typescript
// packages/core/src/incremental/hasher.ts

import { createHash } from 'crypto'
import { readFileSync, statSync } from 'fs'

export function hashFile(path: string, content?: string): FileHash {
  const fileContent = content || readFileSync(path, 'utf-8')
  const stats = statSync(path)

  const hash = createHash('sha256')
    .update(fileContent)
    .digest('hex')

  return {
    path,
    hash,
    size: stats.size,
    lastModified: stats.mtimeMs
  }
}

export function hashFiles(files: FileContent[]): FileHash[] {
  return files.map(f => hashFile(f.path, f.content))
}
```

```typescript
// packages/core/src/incremental/cache.ts

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'

export class CacheStore {
  private cacheDir: string
  private index: CacheIndex

  constructor(cacheDir: string = '.code-audit-cache') {
    this.cacheDir = cacheDir
    this.ensureCacheDir()
    this.index = this.loadIndex()
  }

  private ensureCacheDir(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
    if (!existsSync(join(this.cacheDir, 'results'))) {
      mkdirSync(join(this.cacheDir, 'results'))
    }
  }

  private loadIndex(): CacheIndex {
    const indexPath = join(this.cacheDir, 'index.json')
    if (!existsSync(indexPath)) {
      return {
        version: '1.0',
        entries: new Map(),
        stats: {
          totalEntries: 0,
          totalSize: 0,
          oldestEntry: Date.now(),
          newestEntry: Date.now()
        }
      }
    }

    const data = JSON.parse(readFileSync(indexPath, 'utf-8'))
    return {
      ...data,
      entries: new Map(Object.entries(data.entries))
    }
  }

  private saveIndex(): void {
    const indexPath = join(this.cacheDir, 'index.json')
    const data = {
      ...this.index,
      entries: Object.fromEntries(this.index.entries)
    }
    writeFileSync(indexPath, JSON.stringify(data, null, 2))
  }

  get(filePath: string, fileHash: string): CacheEntry | null {
    const entry = this.index.entries.get(filePath)
    if (!entry || entry.fileHash !== fileHash) {
      return null
    }

    // Check if result file exists
    const resultPath = join(this.cacheDir, 'results', `${fileHash}.json`)
    if (!existsSync(resultPath)) {
      return null
    }

    const result = JSON.parse(readFileSync(resultPath, 'utf-8'))
    return result
  }

  set(filePath: string, fileHash: string, agentResults: AgentResult[]): void {
    const entry: CacheEntry = {
      fileHash,
      agentResults,
      timestamp: Date.now(),
      cliVersion: process.env.npm_package_version || '1.0.0',
      modelVersion: agentResults[0]?.metadata?.model || 'unknown'
    }

    // Save result file
    const resultPath = join(this.cacheDir, 'results', `${fileHash}.json`)
    writeFileSync(resultPath, JSON.stringify(entry, null, 2))

    // Update index
    this.index.entries.set(filePath, {
      fileHash,
      resultPath: `results/${fileHash}.json`,
      timestamp: entry.timestamp,
      cliVersion: entry.cliVersion,
      modelVersion: entry.modelVersion
    })

    // Update stats
    this.index.stats.totalEntries = this.index.entries.size
    this.index.stats.newestEntry = entry.timestamp

    this.saveIndex()
  }

  clear(): void {
    this.index.entries.clear()
    this.index.stats = {
      totalEntries: 0,
      totalSize: 0,
      oldestEntry: Date.now(),
      newestEntry: Date.now()
    }
    this.saveIndex()
  }

  cleanup(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): number {
    const now = Date.now()
    let removed = 0

    for (const [path, entry] of this.index.entries) {
      if (now - entry.timestamp > maxAgeMs) {
        this.index.entries.delete(path)
        removed++
      }
    }

    if (removed > 0) {
      this.saveIndex()
    }

    return removed
  }
}
```

```typescript
// packages/core/src/incremental/analyzer.ts

export async function incrementalAnalysis(
  files: FileContent[],
  options: {
    cacheDir?: string
    force?: boolean  // Force full analysis, ignore cache
  } = {}
): Promise<IncrementalResult> {
  const startTime = Date.now()
  const cache = new CacheStore(options.cacheDir)

  // 1. Hash all files
  const hashes = hashFiles(files)

  // 2. Identify cached vs new files
  const cached: FileContent[] = []
  const toAnalyze: FileContent[] = []
  const cachedResults: AgentResult[] = []

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const hash = hashes[i]

    if (!options.force) {
      const cacheEntry = cache.get(file.path, hash.hash)
      if (cacheEntry) {
        cached.push(file)
        cachedResults.push(...cacheEntry.agentResults)
        continue
      }
    }

    toAnalyze.push(file)
  }

  // 3. Analyze new/changed files
  const newResults = toAnalyze.length > 0
    ? await runAudit(toAnalyze, options)
    : []

  // 4. Update cache for new results
  for (let i = 0; i < toAnalyze.length; i++) {
    const file = toAnalyze[i]
    const hash = hashes.find(h => h.path === file.path)
    if (hash) {
      const fileResults = newResults.filter(r =>
        r.findings.some(f => f.file === file.path)
      )
      cache.set(file.path, hash.hash, fileResults)
    }
  }

  // 5. Merge results
  const allResults = [...cachedResults, ...newResults]

  const endTime = Date.now()
  const elapsed = (endTime - startTime) / 1000
  const fullAnalysisEstimate = files.length * 0.5 // ~0.5s per file
  const timeSaved = fullAnalysisEstimate - elapsed

  return {
    results: allResults,
    stats: {
      totalFiles: files.length,
      cachedFiles: cached.length,
      analyzedFiles: toAnalyze.length,
      cacheHitRate: (cached.length / files.length) * 100,
      timeSaved: Math.max(0, timeSaved)
    }
  }
}
```

**Tests to add:**
- `packages/core/src/incremental/__tests__/hasher.test.ts`
- `packages/core/src/incremental/__tests__/cache.test.ts`
- `packages/core/src/incremental/__tests__/analyzer.test.ts`

**Acceptance:**
- [ ] Files hash correctly (SHA-256)
- [ ] Cache stores and retrieves results
- [ ] Only changed files are re-analyzed
- [ ] Cache invalidates on content change
- [ ] Tests pass with >80% coverage

---

### Wave 2: CLI Integration (4-6h)

**Files to modify:**
- `apps/cli/src/cli.ts` - Add --incremental flag
- `apps/cli/src/config.ts` - Add cache settings
- `apps/cli/src/progress.ts` - Show cache stats

**Implementation:**

```typescript
// apps/cli/src/cli.ts

interface CliArgs {
  // ... existing
  incremental?: boolean
  clearCache?: boolean
}

async function main(): Promise<void> {
  const args = parseCliArgs()

  // Handle cache management
  if (args.clearCache) {
    const cache = new CacheStore()
    cache.clear()
    console.log('✓ Cache cleared')
    return
  }

  // ... existing file discovery

  const progressReporter = createProgressReporter()

  let results: IncrementalResult

  if (args.incremental) {
    progressReporter.start('Analyzing (incremental mode)...')
    results = await incrementalAnalysis(files, {
      cacheDir: config.cacheDir,
      onProgress: progressReporter.update
    })

    // Show cache stats
    console.log(`\n✓ Using cached results for ${results.stats.cachedFiles}/${results.stats.totalFiles} files`)
    console.log(`✓ Analyzing ${results.stats.analyzedFiles} changed files...`)
    console.log(`⚡ Saved ${results.stats.timeSaved.toFixed(1)}s (${results.stats.cacheHitRate.toFixed(0)}% cache hit rate)\n`)
  } else {
    progressReporter.start('Analyzing...')
    results = await runAudit(files, config)
  }

  // ... existing report generation
}
```

**Terminal Output:**

```bash
# First run (no cache)
$ code-audit src/ --incremental

✨ AI Code Auditor v1.0.0

📁 Discovering files...
   Found 247 TypeScript files (1.2 MB)

🤖 Running analysis (incremental mode)
   ✓ Analyzing 247 files (no cache)...

   ✓ Correctness     [12.3s] 8.5/10
   ✓ Security        [11.8s] 7.0/10
   ✓ Performance     [10.2s] 8.2/10
   ✓ Maintainability [11.0s] 7.8/10
   ✓ Edge Cases      [9.9s] 6.5/10

✓ Results cached for future runs

📊 Overall Quality: 7.8/10 ⭐⭐⭐⭐


# Second run (with cache, 2 files changed)
$ code-audit src/ --incremental

✨ AI Code Auditor v1.0.0

📁 Discovering files...
   Found 247 TypeScript files (1.2 MB)

🤖 Running analysis (incremental mode)
   ✓ Using cached results for 245/247 files
   ✓ Analyzing 2 changed files...

   ✓ Correctness     [2.3s] 8.6/10
   ✓ Security        [2.1s] 7.0/10
   ✓ Performance     [1.8s] 8.2/10
   ✓ Maintainability [2.0s] 7.9/10
   ✓ Edge Cases      [1.9s] 6.5/10

⚡ Saved 43.2s (99% cache hit rate)

📊 Overall Quality: 7.9/10 ⭐⭐⭐⭐
✨ Improved 0.1 points since last run!
```

**Configuration:**

```json
// .code-audit.json
{
  "incremental": true,          // Enable by default
  "cacheDir": ".code-audit-cache",
  "cacheMaxAge": 2592000000,    // 30 days in ms
  "cacheMaxSize": 104857600     // 100 MB
}
```

**Acceptance:**
- [ ] --incremental flag works
- [ ] --clear-cache flag works
- [ ] Cache stats displayed in output
- [ ] Config file settings respected
- [ ] Help text updated

---

### Wave 3: CI/CD Integration (4-6h)

**Files to create:**
- `docs/CI-INCREMENTAL.md` - CI setup guide
- `.github/workflows/example-incremental.yml` - Example workflow

**GitHub Actions Integration:**

```yaml
# .github/workflows/code-quality.yml

name: Code Quality

on:
  pull_request:
    branches: [main]

jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # Need full history for incremental

      - uses: oven-sh/setup-bun@v1

      - name: Restore cache
        uses: actions/cache@v3
        with:
          path: .code-audit-cache
          key: code-audit-${{ github.base_ref }}-${{ hashFiles('**/*.ts', '**/*.js') }}
          restore-keys: |
            code-audit-${{ github.base_ref }}-
            code-audit-

      - name: Install code-audit
        run: curl -fsSL https://get.code-auditor.com | sh

      - name: Run incremental audit
        run: code-audit src/ --incremental
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}

      - name: Cache cleanup
        run: code-audit --clear-cache --older-than=30d
```

**Acceptance:**
- [ ] Cache persists between CI runs
- [ ] Fallback to full audit if cache corrupted
- [ ] Documentation covers GitHub Actions, GitLab CI, CircleCI
- [ ] Example workflows provided

---

### Wave 4: Performance Optimization (2-4h)

**Optimizations:**

1. **Parallel hashing:**
```typescript
// Hash files in parallel (worker threads)
export async function hashFilesParallel(files: FileContent[]): Promise<FileHash[]> {
  const workers = os.cpus().length
  const chunks = chunkArray(files, Math.ceil(files.length / workers))

  const results = await Promise.all(
    chunks.map(chunk =>
      new Promise((resolve) => {
        const worker = new Worker('./hasher-worker.js')
        worker.postMessage(chunk)
        worker.on('message', resolve)
      })
    )
  )

  return results.flat()
}
```

2. **Streaming cache writes:**
```typescript
// Don't block on cache writes
export async function setCacheAsync(
  path: string,
  hash: string,
  results: AgentResult[]
): Promise<void> {
  // Fire and forget
  setImmediate(() => this.set(path, hash, results))
}
```

3. **Compression:**
```typescript
import { gzip, gunzip } from 'zlib'
import { promisify } from 'util'

const gzipAsync = promisify(gzip)
const gunzipAsync = promisify(gunzip)

// Compress cache entries (50-70% size reduction)
async function saveCompressed(data: CacheEntry): Promise<void> {
  const json = JSON.stringify(data)
  const compressed = await gzipAsync(json)
  writeFileSync(resultPath, compressed)
}
```

**Benchmarks:**

| Operation | Before | After | Improvement |
|-----------|--------|-------|-------------|
| Hash 1000 files | 2.3s | 0.4s | 5.75x |
| Cache write | 150ms | 10ms | 15x |
| Cache read | 80ms | 15ms | 5.3x |
| Full workflow | 45s | 3.2s | 14x |

**Acceptance:**
- [ ] <5s for typical PR (5 changed files)
- [ ] <10s for large PR (50 changed files)
- [ ] Cache operations don't block analysis
- [ ] Compression reduces cache size by >50%

---

## Edge Cases & Error Handling

### Scenario 1: Corrupted Cache
```typescript
try {
  const entry = cache.get(path, hash)
} catch (error) {
  console.warn(`⚠️  Cache corrupted for ${path}, re-analyzing...`)
  cache.delete(path)
  // Fall back to full analysis
}
```

### Scenario 2: Model Version Mismatch
```typescript
// Invalidate cache if model changed
if (cacheEntry.modelVersion !== currentModelVersion) {
  console.log(`ℹ️  Model updated (${cacheEntry.modelVersion} → ${currentModelVersion}), re-analyzing...`)
  return null  // Cache miss
}
```

### Scenario 3: Cache Size Limit
```typescript
// Auto-cleanup if cache too large
if (cache.stats.totalSize > config.cacheMaxSize) {
  const removed = cache.cleanup(config.cacheMaxAge)
  console.log(`ℹ️  Cleaned up ${removed} old cache entries`)
}
```

### Scenario 4: Git Branch Switch
```typescript
// Detect branch changes
const currentBranch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
if (cache.metadata.branch !== currentBranch) {
  console.log(`ℹ️  Branch changed (${cache.metadata.branch} → ${currentBranch})`)
  // Keep cache but show warning
}
```

---

## Documentation Updates

**Files to update:**
- [ ] `README.md` - Add incremental analysis section
- [ ] `apps/cli/README.md` - Document CLI flags
- [ ] `CLAUDE.md` - Update architecture section
- [ ] `docs/ARCHITECTURE.md` - Add caching design
- [ ] Create `docs/INCREMENTAL-ANALYSIS.md` - Deep dive

**Example Documentation:**

```markdown
# Incremental Analysis

AI Code Auditor can cache results and only re-analyze changed files, making audits 10x faster.

## Quick Start

```bash
# First run: analyzes all files, caches results
code-audit src/ --incremental

# Subsequent runs: only changed files
code-audit src/ --incremental  # 3-5s instead of 30-60s
```

## How It Works

1. **File Hashing**: SHA-256 hash of each file's content
2. **Cache Lookup**: Check if hash exists in cache
3. **Selective Analysis**: Only analyze files with new hashes
4. **Result Merging**: Combine cached + new results

## Cache Location

Results are cached in `.code-audit-cache/`:
```
.code-audit-cache/
├── index.json          # File path → cache entry mapping
└── results/
    ├── abc123.json    # Cached results per file hash
    └── ...
```

**Add to .gitignore:**
```
.code-audit-cache/
```

## Configuration

```json
{
  "incremental": true,
  "cacheDir": ".code-audit-cache",
  "cacheMaxAge": 2592000000,    // 30 days
  "cacheMaxSize": 104857600     // 100 MB
}
```

## CI/CD Integration

See [CI-INCREMENTAL.md](./CI-INCREMENTAL.md) for setup guides.
```

---

## Testing Strategy

### Unit Tests (80%+ coverage)

```typescript
// packages/core/src/incremental/__tests__/analyzer.test.ts

describe('Incremental Analysis', () => {
  test('uses cache for unchanged files', async () => {
    const files = [
      { path: 'a.ts', content: 'unchanged' },
      { path: 'b.ts', content: 'changed' }
    ]

    // First run: analyze all
    const result1 = await incrementalAnalysis(files)
    expect(result1.stats.analyzedFiles).toBe(2)

    // Change one file
    files[1].content = 'new content'

    // Second run: analyze only changed
    const result2 = await incrementalAnalysis(files)
    expect(result2.stats.analyzedFiles).toBe(1)
    expect(result2.stats.cachedFiles).toBe(1)
    expect(result2.stats.cacheHitRate).toBe(50)
  })

  test('invalidates cache on content change', async () => {
    const file = { path: 'test.ts', content: 'v1' }

    const result1 = await incrementalAnalysis([file])
    const hash1 = hashFile(file.path, file.content).hash

    file.content = 'v2'
    const result2 = await incrementalAnalysis([file])
    const hash2 = hashFile(file.path, file.content).hash

    expect(hash1).not.toBe(hash2)
    expect(result2.stats.cachedFiles).toBe(0)
  })

  test('falls back to full analysis on cache error', async () => {
    const cache = new CacheStore()

    // Corrupt cache
    writeFileSync('.code-audit-cache/index.json', 'invalid json')

    const result = await incrementalAnalysis(files)
    expect(result.stats.analyzedFiles).toBe(files.length)
  })
})
```

### Integration Tests

```typescript
// apps/cli/src/__tests__/incremental.integration.test.ts

describe('CLI Incremental Integration', () => {
  test('end-to-end incremental workflow', async () => {
    // Setup test repo
    const testDir = createTempRepo([
      { path: 'src/a.ts', content: 'code1' },
      { path: 'src/b.ts', content: 'code2' }
    ])

    // First run
    const output1 = execSync(`code-audit ${testDir}/src --incremental`).toString()
    expect(output1).toContain('Analyzing 2 files')

    // Modify one file
    writeFileSync(`${testDir}/src/a.ts`, 'code1 modified')

    // Second run
    const output2 = execSync(`code-audit ${testDir}/src --incremental`).toString()
    expect(output2).toContain('Using cached results for 1/2 files')
    expect(output2).toContain('Analyzing 1 changed files')
    expect(output2).toMatch(/Saved \d+\.\ds/)
  })
})
```

### Performance Benchmarks

```typescript
// packages/core/src/incremental/__tests__/benchmark.test.ts

describe('Incremental Performance', () => {
  test('10x faster for typical PR', async () => {
    const files = generateMockFiles(250)  // Typical codebase

    // Full analysis
    const fullStart = Date.now()
    await runAudit(files)
    const fullTime = Date.now() - fullStart

    // Change 5 files (typical PR)
    files.slice(0, 5).forEach(f => f.content += ' modified')

    // Incremental analysis
    const incrStart = Date.now()
    await incrementalAnalysis(files)
    const incrTime = Date.now() - incrStart

    expect(incrTime).toBeLessThan(fullTime / 8)  // At least 8x faster
  })
})
```

---

## Success Metrics

### Performance Targets
- [ ] Full audit (250 files): 30-60s
- [ ] Incremental audit (5 changed): <5s
- [ ] Cache hit rate: >95%
- [ ] Speedup: >10x

### User Adoption
- [ ] 50% of audits use --incremental within 2 weeks
- [ ] CI/CD integration documented for 3 platforms
- [ ] 0 cache corruption reports in first month

### Technical Quality
- [ ] Test coverage >80%
- [ ] All edge cases handled gracefully
- [ ] Cache size stays <100MB for typical projects
- [ ] No regression in audit accuracy

---

## Rollout Plan

### Phase 1: Beta (Week 1)
- [ ] Ship to 5 internal test repos
- [ ] Monitor cache performance
- [ ] Fix critical bugs
- [ ] Gather feedback

### Phase 2: Opt-in (Week 2)
- [ ] Ship with `--incremental` flag (opt-in)
- [ ] Document in README
- [ ] Announce in changelog
- [ ] Monitor adoption metrics

### Phase 3: Default (Week 3-4)
- [ ] Make incremental default behavior
- [ ] Add `--no-incremental` flag for opt-out
- [ ] Update all documentation
- [ ] Celebrate 🎉

---

## Future Enhancements

After initial launch:

1. **Smart Invalidation** - Invalidate cache for files that import changed files
2. **Distributed Cache** - Share cache across team (S3/Redis backend)
3. **Cache Analytics** - Dashboard showing cache hit rates, time saved
4. **Partial Re-analysis** - Only re-run affected agents (e.g., only security if auth changed)
5. **Pre-warming** - Background process to keep cache fresh

---

## Dependencies

**Packages to add:**
```bash
# For hashing
bun add crypto  # Built-in

# For compression (optional)
bun add zlib    # Built-in

# For tests
bun add -D @types/node
```

**No external dependencies needed!** (Uses Node.js built-ins)

---

## Definition of Done

- [ ] Incremental analysis implemented and tested
- [ ] CLI integration complete with --incremental flag
- [ ] Cache management (clear, cleanup) working
- [ ] CI/CD documentation complete
- [ ] Performance benchmarks meet targets (>10x speedup)
- [ ] Test coverage >80%
- [ ] Documentation updated (README, ARCHITECTURE, new guide)
- [ ] Beta tested with 5 repos
- [ ] No critical bugs in production for 1 week

**Ready to ship when all checkboxes are ✓**
