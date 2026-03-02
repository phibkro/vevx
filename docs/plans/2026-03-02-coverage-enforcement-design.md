# Coverage Enforcement Design

## Problem

No CI gate enforces test coverage. Pure/deterministic code and integration code have the same (zero) coverage requirements, despite very different risk profiles.

## Convention: Interface Tests vs Integration Tests

Separate by **what the test verifies**, not where the code lives:

| File pattern | Purpose | Coverage threshold |
|---|---|---|
| `*.test.ts` | Interface/contract tests | 100% line + function |
| `*.integration.test.ts` | External service wiring | None |

**Default is strict.** You opt out by naming a file `.integration.test.ts`.

Interface tests verify the contract callers depend on — gaps here are real bugs. Integration tests verify wiring to LSP, SQLite, subprocess, MCP transport — the interesting failures are environmental, not logical.

## Implementation

### Per-package config (two bunfig files)

**`bunfig.toml`** — used by `test:strict`:

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage"
coverageThreshold = { line = 1.0, function = 1.0 }
```

**`bunfig.integration.toml`** — used by `test:integration`:

```toml
[test]
coverageSkipTestFiles = true
coverageReporter = ["text", "lcov"]
coverageDir = "coverage-integration"
```

### Per-package scripts

```json
{
  "test:strict": "bun test --concurrent --coverage --exclude '*.integration.test.ts'",
  "test:integration": "bun test --concurrent --bunfig bunfig.integration.toml '*.integration.test.ts'",
  "test": "bun run test:strict && bun run test:integration"
}
```

Exact glob patterns vary per package (kart runs `src/pure/` and `src/` separately today — this replaces that split).

### Turbo tasks

```json
{
  "test:strict": { "dependsOn": ["build"] },
  "test:integration": { "dependsOn": ["build"] }
}
```

### CI workflow

```yaml
- name: Test (strict coverage)
  run: bunx turbo test:strict

- name: Test (integration)
  run: bunx turbo test:integration
```

Strict step fails the build if any source file covered by `*.test.ts` drops below 100% line or function coverage. Bun enforces this per-file, not in aggregate.

### Migration

Existing test files that test external integrations get renamed:

- kart: `Editor.test.ts`, `Find.test.ts`, `Imports.test.ts` → `*.integration.test.ts`
- kiste: Files testing SQLite/git → `*.integration.test.ts`
- varp: MCP integration tests → `*.integration.test.ts`

Files that test pure logic keep `*.test.ts` and must hit 100%.

## Documentation

### Testing rules (`.claude/rules/testing.md`)

Path-scoped rule applied when editing `*.test.*` files. Contains:
- File naming convention (`*.test.ts` vs `*.integration.test.ts`)
- What each tier means and when to use which
- Coverage thresholds and how bun enforces them
- The "before writing tests" checklist (consolidated from CLAUDE.md and subagent-conventions.md)

### CLAUDE.md updates

- Add testing convention to Key Conventions section

## Packages affected

All packages with tests: kart, kiste, varp, audit.
