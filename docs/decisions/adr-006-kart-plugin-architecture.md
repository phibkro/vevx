# ADR-006: Kart Multi-Language Support

**Status:** Accepted (Phase 1 implemented)
**Date:** 2026-02-23
**Deciders:** @phibkro

## Context

Kart is typescript-only. The LSP abstraction (`LspClient`) already speaks generic JSON-RPC — the protocol works for any language server. The edit tools are the typescript-specific part, backed by oxc-parser. Adding rust or go support by hardcoding additional language paths into kart core would make the codebase increasingly entangled.

The right separation: kart core is language-agnostic orchestration. Language-specific backends are plugins. But designing a plugin interface with one consumer (typescript) risks getting the abstraction wrong.

## Decision

**Build rust support in kart first, extract the plugin interface second.**

### Phase 1: Add rust-analyzer + tree-sitter to kart

Implement rust language support directly in the existing `@vevx/kart` package. Route by file extension — `.ts`/`.tsx` → oxc + typescript-language-server, `.rs` → tree-sitter-rust + rust-analyzer.

This reveals where typescript assumptions leak:
- LSP initialize params differ (rust-analyzer needs `cargo` metadata)
- AST parsing has different symbol taxonomies (traits vs interfaces, impls vs classes)
- Import resolution is fundamentally different (modules vs crate paths)
- Edit validation uses different syntax checkers

Concrete deliverables:
- `kart_zoom("src/main.rs")` works via rust-analyzer
- `kart_find` scans `.rs` files via tree-sitter
- `kart_replace` edits rust files via tree-sitter AST ranges
- `kart_imports` extracts `use` statements

### Phase 2: Extract the plugin interface

With two working implementations, the natural interface emerges from the shared surface:

```typescript
interface LspPlugin {
  name: string
  extensions: string[]
  spawnLanguageServer(workspaceRoot: string): ChildProcess
  initializeParams?(workspaceRoot: string): Partial<InitializeParams>
}

interface AstPlugin {
  extensions: string[]
  parseSymbols(source: string, path: string): Symbol[]
  locateSymbol(source: string, name: string): ByteRange | null
  validateSyntax(source: string): SyntaxError | null
  isExported(source: string, symbol: Symbol): boolean
  isBarrel(source: string): boolean
  extractImports(source: string, path: string): Import[]
  resolveExternalReference?(specifier: string, fromPath: string): ExternalRef | null
}
```

This interface is provisional — phase 1 will likely reshape it. Methods that don't generalize cleanly (e.g. `isBarrel` may be typescript-only) get dropped or made optional.

### Phase 3: Extract to packages

Once the interface is validated by two implementations:

```
packages/
  kart/        — @vevx/kart core (MCP server, routing, graph algorithms)
  kart-ts/     — @vevx/kart-ts (oxc + typescript-language-server)
  kart-rust/   — @vevx/kart-rust (tree-sitter + rust-analyzer)
  kart-go/     — @vevx/kart-go (future: tree-sitter + gopls)
```

### Routing

Core maintains a registry keyed by file extension. `kart_zoom("src/main.rs")` → rust plugin's LSP. Files with no registered plugin return `PluginUnavailable` — not an error, the agent knows what's missing.

### Language server management

Each language's LSP connection is managed independently. If rust-analyzer fails to start, typescript tools still work. Same isolation principle as the existing per-tool runtime design.

## Cross-language coupling (future)

`resolveExternalReference` enables cross-language coupling detection. When a typescript file imports a wasm module, the typescript backend can return an `ExternalRef` pointing to the rust source. This enables:

- Cross-language `kart_importers` (rust symbols → typescript callers)
- Cross-language `kart_impact` (rust function changed → typescript callers that break)
- Cross-language coupling in `kart_cochange` neighborhood

Gated on two stable backends existing. Phase 1 lays the groundwork but doesn't implement this.

## Consequences

### Phase 1 informs the interface, not the other way around

The interface above is a hypothesis. Implementing rust support will validate or reshape it. Expect:
- Some methods won't generalize (typescript barrels have no rust equivalent)
- Some methods are missing (rust needs crate resolution, go needs module paths)
- Symbol taxonomies differ more than expected (trait impls, associated types, lifetimes)

### tree-sitter for non-typescript AST

Rust and go edit tools use tree-sitter — it has grammars for both, is fast, and is available via `node-tree-sitter`. The AST plugin interface is parser-agnostic: oxc for typescript, tree-sitter for everything else.

### rust-analyzer workspace requirements

Rust-analyzer requires `Cargo.toml` and a buildable workspace. If `cargo check` hasn't run, type information may be incomplete. Kart should degrade gracefully (partial results with a `workspaceNotBuilt` flag).

### Plugin interface stability

The interface is stable once it has three consumers (ts, rust, go). Breaking changes before that are expected and cheap. After that, they require coordinated updates.

## Relationship to other ADRs

- **ADR-005** (edit tools): edit tools will eventually delegate to the AST plugin. The core edit pipeline (locate → validate → splice → write → lint) stays in core.
- **ADR-004** (per-tool runtime): each language's LSP connection gets its own managed runtime. Isolation extends to the plugin layer.
