# Style and Conventions

## Code Style
- ESM only — `import`/`export`, never `require()` or CJS
- Zod schema first, infer TypeScript type via `z.infer<>`
- No standalone interfaces for MCP-facing types
- oxfmt handles all formatting (100-char width, double quotes, trailing commas, sorted imports)
- Conventional Commits for git messages

## Testing
- Co-located `*.test.ts` files next to source
- Run with `bun test`
- MCP integration tests use `InMemoryTransport.createLinkedPair()` + `Client`
- `createServer()` exported from `index.ts` for testability

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
1. `bun test` — all tests pass
2. `bun run check` — format, lint, shellcheck, build all pass
3. Commit with Conventional Commits format
