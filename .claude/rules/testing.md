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
| `*.test.ts` | Interface/contract tests | Coverage reported (95% per-file target) |
| `*.integration.test.ts` | External service wiring (LSP, SQLite, subprocess, MCP) | Coverage reported (no threshold) |
| `*.e2e.test.ts` | End-to-end tests | Coverage reported (no threshold) |

**Default is strict.** Name a file `.integration.test.ts` to opt out of coverage reporting.

## When to use which

**Interface test** (`*.test.ts`) when:
- The function is deterministic (same input, same output)
- No external process, network, or database dependency
- Callers depend on this contract — a gap is a real bug

**Integration test** (`*.integration.test.ts`) when:
- Tests spawn an LSP server, SQLite database, subprocess, or MCP transport
- Failure depends on environment (tool availability, OS, CI sandbox)
- Use `skipIf(process.env.TURBO_HASH)` for tests requiring tools unavailable in CI

## Coverage reporting

Per-package `bunfig.toml` configures coverage reporting (text + lcov). Root bunfig is the canonical source — copies live in each package because bun only reads bunfig from cwd.

Scripts: `test:strict` runs `*.test.ts` with `--coverage`. `test:integration` runs `*.integration.test.ts` with `--coverage` (no threshold).

CI runs both `turbo test:strict` and `turbo test:integration`. Coverage artifacts are uploaded for review. Per-package `coverageThreshold = 0.95` can be enabled as test coverage improves.

## Test quality checklist

Before writing a test, ask:
- What specific bug or regression does this catch?
- Would anyone notice if this test was deleted?
- Am I testing my code or the language?

Prefer fewer, meaningful tests:
- One test per behavior, not one test per code path
- Edge cases and error paths over happy paths
- Test the contract (what), not the implementation (how)
