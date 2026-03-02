# Coverage Enforcement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enforce 100% line + function coverage on interface tests, with lax thresholds on integration tests, across all packages.

**Architecture:** Two-tier testing via file naming convention (`*.test.ts` = strict, `*.integration.test.ts` = lax). Each package gets two bunfig files with different thresholds. CI runs `turbo test:strict` (fails build on coverage gaps) and `turbo test:integration` (no coverage gate) as separate steps. Since bun has no `--exclude` flag, strict scripts use `find` to collect non-integration test files.

**Tech Stack:** Bun (test runner + coverage), Turborepo (task orchestration), GitHub Actions (CI)

**Design doc:** `docs/plans/2026-03-02-coverage-enforcement-design.md`

---

### Task 1: Turbo config — add test:strict, test:integration tasks

**Files:**
- Modify: `turbo.json`

**Step 1: Update turbo.json**

Replace the existing `test:pure` and `test:coverage` tasks with `test:strict` and `test:integration`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["build/**", "dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "test:strict": {
      "dependsOn": ["build"]
    },
    "test:integration": {
      "dependsOn": ["build"]
    },
    "check": {},
    "lint": {},
    "typecheck": {},
    "clean": {
      "cache": false
    }
  }
}
```

**Step 2: Verify turbo resolves tasks**

Run: `bunx turbo test:strict --dry`
Expected: Lists all packages (even those without the script yet — turbo skips missing scripts)

**Step 3: Commit**

```
chore: replace test:pure/test:coverage with test:strict/test:integration in turbo
```

---

### Task 2: kart — bunfig files + rename integration tests + update scripts

**Files:**
- Modify: `packages/kart/bunfig.toml`
- Create: `packages/kart/bunfig.integration.toml`
- Modify: `packages/kart/package.json`
- Rename 17 integration test files (see list below)

kart has 9 pure test files in `src/core/` and ~17 integration tests in `src/`. Currently the split is directory-based — this task switches to naming-based.

**Step 1: Update `packages/kart/bunfig.toml` (strict)**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { line = 1.0, function = 1.0 }
```

**Step 2: Create `packages/kart/bunfig.integration.toml`**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage-integration"
```

**Step 3: Rename integration test files**

These files test LSP, SQLite, subprocess, or MCP transport:

```bash
cd packages/kart/src
mv Editor.test.ts Editor.integration.test.ts
mv Find.test.ts Find.integration.test.ts
mv Imports.test.ts Imports.integration.test.ts
mv Lsp.test.ts Lsp.integration.test.ts
mv TsPlugin.test.ts TsPlugin.integration.test.ts
mv PluginLayers.test.ts PluginLayers.integration.test.ts
mv Plugin.test.ts Plugin.integration.test.ts
mv RustPlugin.test.ts RustPlugin.integration.test.ts
mv PhpPlugin.test.ts PhpPlugin.integration.test.ts
mv Mcp.test.ts Mcp.integration.test.ts
mv Symbols.test.ts Symbols.integration.test.ts
mv Search.test.ts Search.integration.test.ts
mv Diagnostics.test.ts Diagnostics.integration.test.ts
mv Cochange.test.ts Cochange.integration.test.ts
mv List.test.ts List.integration.test.ts
mv call-hierarchy-spike.test.ts call-hierarchy-spike.integration.test.ts
# ExportDetection.integration.test.ts already named correctly
```

**Step 4: Update `packages/kart/package.json` scripts**

```json
{
  "test": "bun run test:strict && bun run test:integration",
  "test:strict": "bun test --concurrent --coverage $(find src -name '*.test.ts' ! -name '*.integration.test.ts')",
  "test:integration": "bun test --concurrent --bunfig bunfig.integration.toml $(find src -name '*.integration.test.ts')"
}
```

**Step 5: Run strict tests to verify 100% coverage**

Run: `cd packages/kart && bun run test:strict`
Expected: All pure tests pass with 100% coverage per file. If any file is below 100%, investigate — either the test is incomplete or the file should be integration.

**Step 6: Run integration tests**

Run: `cd packages/kart && bun run test:integration`
Expected: Integration tests pass (some may skip if LSP/tools unavailable).

**Step 7: Commit**

```
feat(kart): enforce 100% coverage on interface tests

Rename integration tests to *.integration.test.ts convention.
Strict bunfig enforces 100% line + function coverage on interface tests.
```

---

### Task 3: varp — bunfig files + rename integration tests + update scripts

**Files:**
- Modify: `packages/varp/bunfig.toml`
- Create: `packages/varp/bunfig.integration.toml`
- Modify: `packages/varp/package.json`
- Rename 8 integration test files

varp has ~32 pure tests and ~8 integration tests. Currently `test:pure` uses an explicit whitelist — this replaces that with the naming convention.

**Step 1: Update `packages/varp/bunfig.toml` (strict)**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { line = 1.0, function = 1.0 }
```

**Step 2: Create `packages/varp/bunfig.integration.toml`**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage-integration"
```

**Step 3: Rename integration test files**

```bash
cd packages/varp/src
mv manifest/parser.test.ts manifest/parser.integration.test.ts
mv manifest/watch.test.ts manifest/watch.integration.test.ts
mv manifest/env-check.test.ts manifest/env-check.integration.test.ts
mv manifest/scoped-tests.test.ts manifest/scoped-tests.integration.test.ts
mv manifest/imports.test.ts manifest/imports.integration.test.ts
mv manifest/kiste.test.ts manifest/kiste.integration.test.ts
# kiste.e2e.test.ts already named correctly
mv mcp/index.test.ts mcp/index.integration.test.ts
mv cli/__tests__/summary.test.ts cli/__tests__/summary.integration.test.ts
```

**Step 4: Update `packages/varp/package.json` scripts**

Replace `test`, `test:pure`, `test:coverage` with:

```json
{
  "test": "bun run test:strict && bun run test:integration",
  "test:strict": "bun test --concurrent --coverage $(find src -name '*.test.ts' ! -name '*.integration.test.ts' ! -name '*.e2e.test.ts')",
  "test:integration": "bun test --concurrent --bunfig bunfig.integration.toml --reporter=junit --reporter-outfile=test-results.xml $(find src -name '*.integration.test.ts' -o -name '*.e2e.test.ts')"
}
```

**Step 5: Run strict tests, verify 100% coverage**

Run: `cd packages/varp && bun run test:strict`
Expected: All interface tests pass with 100% coverage.

**Step 6: Run integration tests**

Run: `cd packages/varp && bun run test:integration`
Expected: Integration tests pass.

**Step 7: Commit**

```
feat(varp): enforce 100% coverage on interface tests
```

---

### Task 4: audit — bunfig files + rename integration tests + update scripts

**Files:**
- Modify: `packages/audit/bunfig.toml`
- Create: `packages/audit/bunfig.integration.toml`
- Modify: `packages/audit/package.json`
- Rename 4 integration test files

audit has ~11 pure tests and ~3-4 integration tests.

**Step 1: Update `packages/audit/bunfig.toml` (strict)**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { line = 1.0, function = 1.0 }
```

**Step 2: Create `packages/audit/bunfig.integration.toml`**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage-integration"
```

**Step 3: Rename integration test files**

```bash
cd packages/audit/src/__tests__
mv executor.test.ts executor.integration.test.ts
mv orchestrator.test.ts orchestrator.integration.test.ts
mv drift.test.ts drift.integration.test.ts
mv auth.test.ts auth.integration.test.ts
```

**Step 4: Update `packages/audit/package.json` scripts**

Replace `test`, `test:coverage` with:

```json
{
  "test": "bun run test:strict && bun run test:integration",
  "test:strict": "bun test --concurrent --coverage $(find src -name '*.test.ts' ! -name '*.integration.test.ts')",
  "test:integration": "bun test --concurrent --bunfig bunfig.integration.toml $(find src -name '*.integration.test.ts')"
}
```

**Step 5: Run strict tests, verify 100% coverage**

Run: `cd packages/audit && bun run test:strict`

**Step 6: Commit**

```
feat(audit): enforce 100% coverage on interface tests
```

---

### Task 5: kiste — bunfig files + update scripts

**Files:**
- Modify: `packages/kiste/bunfig.toml`
- Create: `packages/kiste/bunfig.integration.toml`
- Modify: `packages/kiste/package.json`

kiste has 5 test files, all integration (SQLite, git subprocess). No strict tests to enforce yet — but set up the infrastructure so future pure functions get enforced automatically.

**Step 1: Update `packages/kiste/bunfig.toml` (strict)**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { line = 1.0, function = 1.0 }
```

**Step 2: Create `packages/kiste/bunfig.integration.toml`**

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage-integration"
```

**Step 3: Rename all test files to integration**

```bash
cd packages/kiste/src
mv Git.test.ts Git.integration.test.ts
mv Indexer.test.ts Indexer.integration.test.ts
mv Config.test.ts Config.integration.test.ts
mv Tags.test.ts Tags.integration.test.ts
mv Tools.test.ts Tools.integration.test.ts
```

**Step 4: Update `packages/kiste/package.json` scripts**

```json
{
  "test": "bun run test:strict && bun run test:integration",
  "test:strict": "bun test --concurrent --coverage $(find src -name '*.test.ts' ! -name '*.integration.test.ts') 2>/dev/null || echo 'No strict tests found'",
  "test:integration": "bun test --concurrent --bunfig bunfig.integration.toml $(find src -name '*.integration.test.ts')"
}
```

Note: `test:strict` handles the case where no `*.test.ts` files exist yet (all are integration).

**Step 5: Commit**

```
feat(kiste): set up coverage enforcement infrastructure
```

---

### Task 6: CI workflow — replace test:coverage with test:strict + test:integration

**Files:**
- Modify: `.github/workflows/ci.yml`

**Step 1: Update CI workflow**

Replace the existing test + coverage steps with:

```yaml
      - name: Format + Lint + Build
        run: bunx turbo check

      - name: Test (strict — 100% coverage on interface tests)
        run: bunx turbo test:strict

      - name: Test (integration)
        run: bunx turbo test:integration

      - name: Upload coverage
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: coverage
          path: packages/*/coverage/
```

Remove the old `Test` and `Test with coverage` steps.

**Step 2: Commit**

```
ci: enforce 100% coverage on interface tests, separate integration step
```

---

### Task 7: Documentation — testing rules + CLAUDE.md update

**Files:**
- Create: `.claude/rules/testing.md`
- Modify: `CLAUDE.md` (Key Conventions section, line 85)
- Delete: `.claude/rules/subagent-conventions.md`

**Step 1: Create `.claude/rules/testing.md`**

Path-scoped rule that activates when editing test files:

```markdown
---
paths:
  - "**/*.test.*"
  - "**/*.integration.test.*"
  - "**/*.e2e.test.*"
  - "**/bunfig*.toml"
---

# Testing Conventions

## File Naming

| Pattern | Purpose | Coverage |
|---|---|---|
| `*.test.ts` | Interface/contract tests | 100% line + function (enforced per-file) |
| `*.integration.test.ts` | External service wiring (LSP, SQLite, subprocess, MCP) | No threshold |
| `*.e2e.test.ts` | End-to-end tests | No threshold |

**Default is strict.** Name a file `.integration.test.ts` to opt out of coverage enforcement.

## When to use which

**Interface test** (`*.test.ts`) when:
- The function is deterministic (same input → same output)
- No external process, network, or database dependency
- Callers depend on this contract — a gap is a real bug

**Integration test** (`*.integration.test.ts`) when:
- Tests spawn an LSP server, SQLite database, subprocess, or MCP transport
- Failure depends on environment (tool availability, OS, CI sandbox)
- Use `skipIf(process.env.TURBO_HASH)` for tests requiring tools unavailable in CI

## Coverage enforcement

Each package has two bunfig files:
- `bunfig.toml` — strict: `coverageThreshold = { line = 1.0, function = 1.0 }`
- `bunfig.integration.toml` — lax: no threshold

Scripts: `test:strict` runs `*.test.ts` with coverage enforcement. `test:integration` runs `*.integration.test.ts` without.

CI runs `turbo test:strict` (build-breaking) then `turbo test:integration`.

## Test quality checklist

Before writing a test, ask:
- What specific bug or regression does this catch? If you can't name one, don't write it.
- Would anyone notice if this test was deleted? If "no," it's not testing behavior.
- Am I testing my code or the language? Type checks belong to TypeScript, not tests.
- Does a test helper for this already exist in a fixtures file?

Prefer fewer, meaningful tests:
- One test per behavior, not one test per code path.
- Edge cases and error paths over happy paths.
- Test the contract (what), not the implementation (how).
```

**Step 2: Update CLAUDE.md Key Conventions — Tests line**

Replace line 85:

```
- **Tests**: Co-located with source (`*.test.ts`). Run concurrently (`--concurrent`). Use `bun-testing` skill for patterns. Integration tests use `InMemoryTransport` + `Client`.
```

With:

```
- **Tests**: Co-located with source. `*.test.ts` = interface tests (100% coverage enforced), `*.integration.test.ts` = external service tests (lax). Run concurrently (`--concurrent`). See `.claude/rules/testing.md` for conventions.
```

**Step 3: Delete `.claude/rules/subagent-conventions.md`**

This file is stale. Testing guidance moves to `testing.md`. Component listings and code quality guidelines are already in CLAUDE.md.

```bash
git rm .claude/rules/subagent-conventions.md
```

**Step 4: Commit**

```
docs: add testing conventions rule, update CLAUDE.md, remove stale subagent-conventions
```

---

### Task 8: Verify end-to-end

**Step 1: Run full turbo check + test suite**

```bash
bunx turbo check
bunx turbo test:strict
bunx turbo test:integration
```

**Step 2: Verify CI would pass**

Check that `test:strict` fails if you temporarily lower coverage in a pure file (add an untested branch), then revert.

**Step 3: Final commit if any fixups needed**
