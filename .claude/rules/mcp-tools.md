---
paths:
  - "src/**/*.ts"
---

# MCP Tool Development

## Adding a New Tool

1. Write the pure function in the appropriate module (`manifest/`, `scheduler/`, `plan/`, `enforcement/`)
2. Add Zod schemas to `src/types.ts` for any new return types
3. Add a `ToolDef` entry to `src/index.ts` — handler returns a plain object, `registerTools()` wraps with JSON serialization + error handling
4. Add unit tests for the pure function + integration test in `src/index.test.ts`
5. Update `src/README.md` with tool documentation and any new types

## Testing MCP Tools

Integration tests use in-process transport (no subprocess/stdio). See `src/index.test.ts` for the current pattern — import paths for `Client`, `InMemoryTransport`, and `McpServer` change across SDK versions. Check `docs/reference-urls.md` → MCP TypeScript SDK for current imports.

## Zod Convention

Every type is a Zod schema first. Never define a standalone TypeScript interface.

```typescript
// Correct
export const FooSchema = z.object({ bar: z.string() });
export type Foo = z.infer<typeof FooSchema>;

// Wrong — type drift risk
export interface Foo { bar: string }
```
