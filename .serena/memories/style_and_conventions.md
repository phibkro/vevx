# Style and Conventions

## Code Style
- ESM only — `import`/`export`, never `require()` or CJS
- Zod schema first, infer TypeScript type via `z.infer<>`
- No standalone interfaces for MCP-facing types
- oxfmt handles all formatting (100-char width, double quotes, trailing commas, sorted imports)
- Conventional Commits for git messages

## Testing
- Core: co-located `*.test.ts` files, run with `bun test` in packages/core/
- Audit: vitest in packages/audit/, co-located in src/__tests__/
- MCP integration tests use `InMemoryTransport.createLinkedPair()` + `Client`
- `createServer()` exported from `packages/core/src/index.ts` for testability

## MCP Tools
- Accept `manifest_path` parameter (default `./varp.yaml`)
- Parse internally, return JSON as text content
- Shared schemas reused across tool definitions

## Hooks
- No runtime dependencies (no jq/python)
- Parse with grep/sed/awk + bash parameter expansion
- Exit 0 when varp.yaml missing
- Must pass shellcheck

## Task Completion Checklist
1. `bun test` in packages/core/ — all 296 tests pass
2. `bun run check` in packages/core/ — format, lint, shellcheck, build all pass
3. `npx vitest run` in packages/audit/ — all 187 tests pass
4. Commit with Conventional Commits format
