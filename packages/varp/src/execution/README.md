# Execution

Shared execution-layer types, schemas, and utilities. Implements Layer 3 of the three-layer architecture (ADR-002).

## Key Exports

| Export                                          | File             | Purpose                                                          |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------------- |
| `FileContentSchema` / `FileContent`             | `chunker.ts`     | File with path, content, language, and size metadata             |
| `ChunkSchema` / `Chunk`                         | `chunker.ts`     | Token-bounded group of files                                     |
| `estimateTokens()`                              | `chunker.ts`     | Approximate token count (~4 chars/token)                         |
| `createChunks()`                                | `chunker.ts`     | Split files into token-bounded chunks with 90% safety margin     |
| `formatChunkSummary()`                          | `chunker.ts`     | Human-readable chunk statistics                                  |
| `ModelCallerResultSchema` / `ModelCallerResult` | `types.ts`       | LLM call result: text, structured output, usage, cost            |
| `ModelCaller`                                   | `types.ts`       | Function type for LLM invocation (system + user prompt → result) |
| `TaskResultSchema` / `TaskResult`               | `types.ts`       | Structured executor output: status, metrics, files, observations |
| `TaskResultMetricsSchema` / `TaskResultMetrics` | `types.ts`       | Token usage, duration, and optional cost                         |
| `runWithConcurrency()`                          | `concurrency.ts` | Generic bounded worker pool with `onResult`/`onError` callbacks  |
| `ConcurrencyCallbacks`                          | `concurrency.ts` | Callback interface for monitoring concurrent task execution      |

## Design

All types are Zod-schema-first where possible. `ModelCaller` is a plain TypeScript function type since Zod cannot express function signatures.

The chunker is pure computation with no I/O — it operates on `FileContent[]` arrays. File discovery and reading happen upstream (in the consuming package).

`TaskResult` captures the four-state executor output contract (`COMPLETE|PARTIAL|BLOCKED|NEEDS_REPLAN`) with optional metrics and observations. This is the interface contract between the scheduler and any executor adapter.

`runWithConcurrency` is a generic worker pool that spawns up to N workers pulling from a shared queue. It is executor-agnostic — used by `@varp/audit` for parallel LLM calls and available for any domain package needing bounded parallelism.

## Consumers

- `@varp/audit` — imports `runWithConcurrency` from `@varp/core/lib` for parallel audit task execution
- Future domain packages (migration, documentation, test generation) can import directly
