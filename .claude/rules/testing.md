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
- The function is deterministic (same input, same output)
- No external process, network, or database dependency
- Callers depend on this contract — a gap is a real bug

**Integration test** (`*.integration.test.ts`) when:
- Tests spawn an LSP server, SQLite database, subprocess, or MCP transport
- Failure depends on environment (tool availability, OS, CI sandbox)
- Use `skipIf(process.env.TURBO_HASH)` for tests requiring tools unavailable in CI

## Coverage enforcement

Root `bunfig.toml` enforces strict thresholds. Root `bunfig.integration.toml` has no thresholds.

Scripts: `test:strict` runs `*.test.ts` with coverage enforcement. `test:integration` runs `*.integration.test.ts` without.

CI runs `turbo test:strict` (build-breaking) then `turbo test:integration`.

## Test quality checklist

Before writing a test, ask:
- What specific bug or regression does this catch?
- Would anyone notice if this test was deleted?
- Am I testing my code or the language?

Prefer fewer, meaningful tests:
- One test per behavior, not one test per code path
- Edge cases and error paths over happy paths
- Test the contract (what), not the implementation (how)
