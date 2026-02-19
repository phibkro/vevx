# Test Coverage Analysis

**Date**: 2026-02-19
**Scope**: Full monorepo (`packages/core`, `packages/audit`, `packages/cli`, `packages/mcp`)

## Overview

| Package | Source Files | Test Files | Ratio | Assessment |
|---------|-------------|------------|-------|------------|
| `packages/core` | 47 | 24 | 51% | Strong — nearly all exported functions tested |
| `packages/audit` | 44 | 17 | 39% | Moderate — planner well-tested, agents/report/CLI gaps |
| `packages/cli` | 11 | 1 | 9% | Weak — only `errors.ts` tested |
| `packages/mcp` | 2 | 1 | 50% | Good — 23/28 tools tested via integration |
| **Total** | **104** | **43** | **41%** | |

File count alone is misleading. The core package has ~94% of its exported public API covered by tests. The real gaps are concentrated in `packages/cli` and specific subsystems of `packages/audit`.

## What's Working Well

**Core package**: Mature testing practices throughout. Tests are behavior-focused, use helper factories (`makeTask`, `makeLog`, `makeLinkResult`), cover error/edge cases consistently, and use both fixture-based and synthetic data. The `co-change.test.ts` and `lint.test.ts` files are standout examples of thorough coverage.

**MCP integration tests**: 44 tests covering 23/28 tools via `InMemoryTransport + Client`. Full protocol-level testing without requiring stdio transport.

**Audit planner**: The `__tests__/` directory covers most planner modules (findings, executor, planner, diff-filter, drift, suppressions, compliance-reporter, manifest-adapter, prompt-generator, ruleset-parser).

## Priority 1: CLI Package (Highest Impact)

The CLI has 11 source files and 1 test. These files contain pure, easily-testable logic:

### `coupling.ts` — Complex classification logic

- `classifyFileEdge()` — 4-level quadrant classification (structural vs. behavioral coupling thresholds). Complex conditional logic with no coverage.
- `renderBar()` — Weight-to-bar-chart math with boundary conditions.
- `buildImportPairSet()` — Data transformation from import results to queryable pairs.

### `args.ts` — Shared argument utilities

- `parseEnum()` — Validates strings against allowed enum values with error messages.
- `consumeOptionalFlag()` — Parses flag values with defaults, handles missing args and prefix stripping.

### `graph.ts` — Flag interaction logic

- `parseGraphArgs()` — State transitions between `--tags`, `--no-tags`, `--no-color` affecting tag mode.

### `validate.ts` — Positional argument parsing

- `parseValidateArgs()` — Positional plan path argument plus flag handling with validation.

## Priority 2: Audit Report Module (Zero Tests)

`packages/audit/src/report/` has 4 files and 0 tests:

### `synthesizer.ts` — Business-critical scoring logic

- `synthesizeReport()` — Weighted average calculation across agents, finding categorization, top-N recommendation selection.
- Edge cases: all agents score 0, single agent, weights not summing to 1.0, mixed severity findings.

### `terminal.ts` — User-facing output

- Score-to-color thresholds (green >= 8, yellow >= 6, red < 6).
- Star rating calculation.
- Finding detail formatting (severity, file:line format).
- Empty findings rendering.

### `markdown.ts` — Exportable report format

- Agent breakdown table structure.
- Finding severity emoji assignment.
- Recommendation prioritization logic.

## Priority 3: Audit Agent File Filters

`packages/audit/src/agents/` has 12 source files but only 1 test (`parsing.test.ts` covering the shared factory). Two agents have conditional `fileFilter` functions:

### `accessibility.ts`

- Filter: `/\.(jsx|tsx|vue|html|svelte)$/.test(f.relativePath)`
- Untested: case sensitivity, compound extensions (`.test.tsx`), path-embedded extensions (`components.jsx/data.ts`).

### `documentation.ts`

- Filter: excludes `.test.`, `.spec.`, `__tests__/`, `test/`, `.md` patterns.
- Untested: edge cases like `file.test.md`, `__tests__/index.ts`, files mixing patterns.

## Priority 4: Audit CLI Subsystem

`packages/audit/src/cli/` has 8+ source files with only `auth.test.ts` covered:

### `audit.ts` — Entry point with complex arg parsing

- `parseAuditArgs()` — 8+ flags (`--ruleset`, `--model`, `--format`, `--output`, `--quiet`, `--diff`, `--budget`, `--baseline`).
- `resolveRuleset()` — 4-path resolution (direct path, built-in, CWD relative, CWD with `.md` fallback).

### `claude-client.ts` — Subprocess interaction

- `parseJsonEnvelope()` — Parses Claude CLI JSON output; handles arrays, missing result fields, structured output vs raw text.
- `callClaude()` — Env var filtering, exit code handling.

### `formatters/html.ts` — 341-line HTML template

- Special character escaping, empty findings handling, category count rendering.

## Priority 5: MCP Missing Tool Tests

5 of 28 MCP tools lack test coverage in `packages/mcp/src/index.test.ts`:

- `varp_ack_freshness`
- `varp_build_codebase_graph`
- `varp_coupling_hotspots`
- `varp_coupling_matrix`
- `varp_scan_co_changes`

These are all analysis-layer tools. Adding integration tests for them would bring MCP coverage from 82% to 100%.

## Priority 6: Core I/O Wrappers

A few thin I/O wrappers in `@varp/core/lib` exports lack tests (their pure inner functions are tested):

- `parsePlanFile()` — Reads XML from disk, delegates to tested `parsePlanXml()`.
- `countLines()` — Filesystem line counting.
- `computeComplexityTrends()` — Calls `git log --numstat`, delegates to tested `computeComplexityTrendsFromStats()`.

These are low priority since the core logic is covered, but they represent integration-level gaps.

## Recommendations

### Where to start

1. **CLI `coupling.ts`** — Highest density of untested pure logic. `classifyFileEdge()` alone has 4 classification outcomes with threshold-based conditions. Write 8-10 tests.
2. **CLI `args.ts`** — Foundation used by all CLI commands. 4-5 tests for `parseEnum()` and `consumeOptionalFlag()` error cases.
3. **Audit `synthesizer.ts`** — Business-critical scoring that affects all audit output. 6-8 tests for weighted averages and finding categorization.
4. **MCP missing tools** — 5 integration tests to reach 100% tool coverage.

### What not to test

- Agent system prompt strings (static data, no logic).
- `completions.ts` (static template generation).
- Re-export index files.
- `cli.ts` main router (mostly `process.exit()` and `console.log()`).
- Type-only files like `execution/types.ts`.

### Patterns to follow

The existing tests in `packages/core/` demonstrate the project's conventions well:
- Co-locate tests with source (`*.test.ts` next to `*.ts`).
- Use factory helpers for test data (e.g., `makeTask()`, `makeLog()`).
- Test behaviors and contracts, not implementation.
- Cover error/edge cases as first-class concerns.
- Use `bun test --concurrent` for fast parallel execution.
