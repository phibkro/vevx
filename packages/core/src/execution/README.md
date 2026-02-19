# Execution

Shared execution-layer types and utilities. Extracted from `@varp/audit` to enable reuse across domain packages.

## Key Exports

| Export | File | Purpose |
|--------|------|---------|
| `FileContentSchema` / `FileContent` | `chunker.ts` | File with path, content, language, and size metadata |
| `ChunkSchema` / `Chunk` | `chunker.ts` | Token-bounded group of files |
| `estimateTokens()` | `chunker.ts` | Approximate token count (~4 chars/token) |
| `createChunks()` | `chunker.ts` | Split files into token-bounded chunks with 90% safety margin |
| `formatChunkSummary()` | `chunker.ts` | Human-readable chunk statistics |
| `ModelCallerResultSchema` / `ModelCallerResult` | `types.ts` | LLM call result: text, structured output, usage, cost |
| `ModelCaller` | `types.ts` | Function type for LLM invocation (system + user prompt → result) |

## Design

All types are Zod-schema-first where possible. `ModelCaller` is a plain TypeScript function type since Zod cannot express function signatures.

The chunker is pure computation with no I/O — it operates on `FileContent[]` arrays. File discovery and reading happen upstream (in the consuming package).

## Consumers

- `@varp/audit` — re-exports from `@varp/core/lib` (backward-compatible)
- Future domain packages (migration, documentation, test generation) can import directly
