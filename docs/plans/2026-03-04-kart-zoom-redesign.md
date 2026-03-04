# Kart Zoom API Redesign

Addresses #24 (API semantics) and #25 (.d.ts caching).

## Problem

`kart_zoom` conflates symbol nesting depth with output mode (level 2 = raw file content). Output is ad-hoc plaintext that resembles TypeScript but isn't valid syntax. Agents already understand `.d.ts` — we should emit real declarations and provide progressive disclosure of the type graph.

## Design

### API Surface

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `path` | string | required | File or directory path |
| `depth` | 0-2 | 0 | BFS hops through type dependency graph. 0 = this file's declarations, 1 = + referenced types, 2 = two hops |
| `visibility` | `"exported"` \| `"all"` | `"exported"` | Filter by symbol visibility |
| `kind` | string[] | all | Filter by symbol kind (`"function"`, `"class"`, `"interface"`, `"type"`, `"struct"`, `"trait"`, etc.) |
| `deep` | boolean | false | Follow full type graph (generics, constraints, mapped types). Default follows signature references only |

Dropped: `level` parameter. No raw-file-content mode — agents use `Read` for that.
Dropped: `resolveTypes` — tsc provides full type inference in the generated `.d.ts`.

### TypeScript: tsc Declaration Generation

**Generation**: `tsc --declaration --emitDeclarationOnly --incremental` emits `.d.ts` files + `.tsbuildinfo` into `.kart/decls/` shadow tree.

**Incremental rebuild**: `.tsbuildinfo` tracks file dependencies. Only changed files re-emit on subsequent builds. First build is the only expensive one.

**Depth traversal** (BFS on type graph):
- `depth=0`: Return the requested file's `.d.ts` only.
- `depth=1`: Parse the `.d.ts` for type references in signatures (param types, return types, extends/implements, property types). Pull in those files' `.d.ts` declarations too.
- `depth=2`: Repeat one more hop from the depth-1 frontier.
- `deep: true`: Expand the reference set to include generic constraints, conditional types, mapped types, utility type parameters.

**What's in the `.d.ts`**:
- `export declare function`, `export declare class`, `export declare type`, `export declare const`, `export declare enum`, `export declare interface`
- Class bodies include method signatures and property declarations
- JSDoc comments preserved
- Re-exports resolved
- Full type inference (tsc resolves `const x = foo()` to its return type)

### Rust: On-Demand via tree-sitter

No caching. tree-sitter is fast enough for on-demand extraction.

**`depth`** for Rust follows `use` declarations to pull referenced type signatures from other files (via rust-analyzer if available, graceful degradation to tree-sitter-only if not).

**Filters** (`visibility`, `kind`) apply the same way — just operating on tree-sitter extraction results instead of cached `.d.ts`.

### Cache Structure

```
.kart/
  decls/
    tsconfig.tsbuildinfo
    src/
      foo.d.ts              # mirrors src/foo.ts
      bar/
        baz.d.ts            # mirrors src/bar/baz.ts
```

Gitignored. Rebuilt incrementally on source changes detected at zoom request time.

### Directory Zoom

- `depth=0`: File list + export counts (current fast path via oxc, no tsc needed). Unchanged.
- `depth=1+`: Per-file filtered declarations. TS reads from cache, Rust parses on demand.

### Output Format

Plaintext (no `structuredContent`). For TS files, the content IS valid `.d.ts`. For Rust, it's pub signatures in idiomatic Rust syntax (no bodies).

### Migration

Clean break — kart is experimental.

- `level` param removed → `depth` (with BFS semantics)
- `level: 2` (raw content) removed → agents use `Read`
- `resolveTypes` removed → tsc provides inference, no separate LSP enrichment needed
- Output format changes from ad-hoc plaintext to `.d.ts` (TS) / pub signatures (Rust)
- `kart:zoom` skill prompt updated
- SessionStart/SubagentStart hook prompts updated

## Non-Goals

- Not a general-purpose build tool — only generates declarations for kart's consumption
- Not replacing `tsc --declaration` in the project build pipeline
- No Rust declaration caching (tree-sitter is fast enough on-demand)

## Relationship to Other Issues

- **#24**: Subsumed — depth-based API with filters replaces level-based API
- **#25**: Implemented — `.d.ts` generation + caching is the core of this work
- **#30 (ADR-008)**: `.d.ts` caching is a first instance of the knowledge build system pattern (derived artifact with staleness tracking and incremental rebuild)
