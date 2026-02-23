# kart v0.5 — serena replacement for typescript

**Date:** 2026-02-23
**Goal:** Ship the minimum tool set that lets serena be disabled for typescript projects.
**Approach:** Navigation first (read-only parity), then editing (full replacement). Two phases, each independently shippable.

## Scope

### Must have (blocks serena removal)

| kart tool | replaces serena | phase |
|-----------|----------------|-------|
| `kart_find` | `find_symbol` | 4a |
| `kart_search` | `search_for_pattern` | 4a |
| `kart_list` | `list_dir`, `find_file` | 4a |
| `kart_replace` | `replace_symbol_body` | 4b |
| `kart_insert_after` | `insert_after_symbol` | 4b |
| `kart_insert_before` | `insert_before_symbol` | 4b |

### Already shipped

`kart_zoom` replaces `get_symbols_overview`. `kart_impact`/`kart_deps` supersede `find_referencing_symbols` for transitive analysis.

### Deferred

- `kart_references` — not in regular usage pattern
- `kart_rename` — different complexity class (LSP `textDocument/rename`)
- `kart_diagnostics` — standalone tool deferred; inline lint on edit covers primary use case
- `kart_restart` — LSP restarts on runtime disposal
- Sqlite symbol index — on-demand parse first, add index when latency demands it
- kart_zoom oxc migration — LSP zoom works fine

## Foundation: oxc-parser integration

**New dependency:** `oxc-parser` (native binding) in `packages/kart/package.json`.

**New pure module:** `src/pure/OxcSymbols.ts`

```typescript
parseSymbols(source: string, filename: string): OxcSymbol[]

interface OxcSymbol {
  name: string
  kind: string          // "function" | "class" | "interface" | "type" | "const" | "enum" | ...
  exported: boolean
  line: number
  range: { start: number; end: number }  // byte offsets — needed for edit tools
}
```

Pure function, no IO. Shared primitive for `kart_find` (symbol search) and edit tools (symbol location). Range data stored from day one even though `kart_find` only needs name + kind + line.

## Phase 4a: Navigation

### kart_find

```typescript
kart_find(name: string, kind?: string, exported?: boolean, path?: string): FindResult

interface FindResult {
  symbols: FoundSymbol[]
  truncated: boolean      // true if fileCount exceeds cap
  fileCount: number       // total files scanned
  durationMs: number      // latency instrumentation for future index decision
}

interface FoundSymbol {
  name: string
  kind: string
  path: string
  line: number
  exported: boolean
}
```

On-demand: glob `.ts`/`.tsx` (excluding `node_modules`, `.git`), parse each with oxc-parser, filter by name (substring match), kind, exported. `path` parameter scopes search to a subdirectory. Cap at 2000 files — return `{ truncated: true }` above that.

Backend: oxc-parser, no LSP.

### kart_search

```typescript
kart_search(pattern: string, glob?: string, paths?: string[]): SearchResult

interface SearchResult {
  matches: { path: string; line: number; text: string }[]
  truncated: boolean      // true if matches exceed 100
}
```

Shells out to `Bun.spawn(["rg", "--json", pattern, ...])`. Gitignore-aware by default. Cap at 100 matches.

Backend: ripgrep subprocess.

### kart_list

```typescript
kart_list(path: string, recursive?: boolean, glob?: string): ListResult

interface ListResult {
  entries: { name: string; path: string; isDirectory: boolean; size?: number }[]
  truncated: boolean
}
```

`readdirSync` + gitignore filtering. Recursive defaults to false. Glob filter optional.

Backend: fs + gitignore rules.

## Phase 4b: Editing

All three edit tools share the same pipeline:

```
1. read file from disk
2. parse with oxc-parser → AST → find symbol by name → byte range
3. parse NEW content with oxc-parser → reject if syntax error (no disk write)
4. splice:
     replace:       file[0..start] + newContent + file[end..]
     insert_after:  file[0..end]   + newContent + file[end..]
     insert_before: file[0..start] + newContent + file[start..]
5. write file
6. run oxlint --type-aware on changed file → return diagnostics inline
```

### Pure module: `src/pure/AstEdit.ts`

```typescript
locateSymbol(ast: Program, name: string): { start: number; end: number } | null
validateSyntax(source: string, filename: string): SyntaxError | null
spliceReplace(file: string, range: Range, content: string): string
spliceInsertAfter(file: string, range: Range, content: string): string
spliceInsertBefore(file: string, range: Range, content: string): string
```

Pure, testable without IO.

### Effectful service: `src/Editor.ts`

Effect service for the full pipeline. Handles file read/write and oxlint subprocess. Does NOT depend on LspClient — edits are oxc-only.

**Separate runtime:** `editorRuntime` — independent of `zoomRuntime` and `cochangeRuntime`. Per-tool runtime principle (ADR-004).

### Oxlint integration

```typescript
runOxlint(paths: string[]): Effect<Diagnostic[], OxlintUnavailableError>
```

Shells out to `oxlint --type-aware --format json`. If oxlint or tsgolint is missing, returns empty diagnostics with `oxlintAvailable: false` — graceful degradation, not failure.

### Tool signatures

```typescript
kart_replace(file: string, symbol: string, content: string): EditResult
kart_insert_after(file: string, symbol: string, content: string): EditResult
kart_insert_before(file: string, symbol: string, content: string): EditResult

interface EditResult {
  success: boolean
  path: string
  symbol: string
  diagnostics: Diagnostic[]
  syntaxError: boolean
  syntaxErrorMessage?: string
}
```

### Symbol ambiguity

If multiple symbols match the name, return an error listing the matches with line numbers. No silent "first match wins." The agent disambiguates by using a `line` hint or zooming the file first.

## Architecture

### New modules

```
src/
  pure/
    OxcSymbols.ts     — parseSymbols() shared primitive (oxc-parser)
    AstEdit.ts        — locateSymbol, validateSyntax, splice functions
  Editor.ts           — effectful edit service (file IO + oxlint)
```

### Runtime topology after v0.5

```
McpServer
  ├─ cochangeRuntime  → CochangeDb (bun:sqlite, read-only)
  ├─ zoomRuntime      → SymbolIndex → LspClient (typescript-language-server)
  └─ editorRuntime    → Editor (oxc-parser, oxlint subprocess)
```

Navigation tools (`kart_find`, `kart_search`, `kart_list`) don't need a managed runtime — they're stateless. They run directly in the MCP handler with no Effect service layer.

### Dependencies added

```
oxc-parser    — native AST parsing (shared by find + edit)
```

No other new dependencies. Ripgrep and oxlint are external binaries, not npm packages.

## Testing strategy

### Pure modules (coverage-gated)

- `OxcSymbols.test.ts` — parse various declaration forms, verify name/kind/exported/range
- `AstEdit.test.ts` — locate symbol, splice operations, syntax validation rejection

### Integration (no coverage gate)

- `kart_find` — MCP integration via InMemoryTransport, substring matching, truncation, path scoping
- `kart_search` — ripgrep results, truncation, gitignore respect
- `kart_list` — directory listing, recursive, gitignore filtering
- `kart_replace` — successful edit, syntax error rejection, inline diagnostics, symbol ambiguity error
- `kart_insert_after` / `kart_insert_before` — splice correctness, inline diagnostics

Edit tool tests use temp directories with fixture files. No LSP needed — edits are oxc-only.

## Delivery

Phase 4a ships first. Agents get read-only serena parity immediately. Phase 4b ships second. After 4b, serena is disabled for this repo.

Each phase gets its own changeset (minor version bump).
