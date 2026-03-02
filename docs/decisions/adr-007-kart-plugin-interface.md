ADR-007: Kart Plugin Interface — LSP and AST Capability Split

**Status:** Accepted
**Date:** 2026-03-02
**Deciders:** @phibkro
**Relates to:** ADR-006 (multi-language support, phased implementation)

## Context

ADR-006 decided to add rust support by implementing it directly in kart first, then extracting a plugin interface once two concrete implementations existed. That implementation is now underway. This ADR records the interface design that emerged from that process — specifically how the plugin boundary should be drawn and how it maps to Effect services.

ADR-006 described a single monolithic plugin type. During design, it became clear that LSP capability and AST capability are independent — a language can have one without the other, and tools depend on them differently. This separation needs to be explicit in the interface.

### Two distinct capabilities

**LSP capability** — zoom, impact, deps, references, rename. Any language with an LSP server gets this. The underlying data comes from JSON-RPC; kart's LSP client is already language-agnostic at the transport level. The only language-specific parts are: which binary to spawn, what initialize params to send, and how to map file extensions to language IDs.

**AST capability** — find, edit (replace/insert/insert_before). These need direct parser access for two reasons LSP doesn't cover: byte-accurate ranges for splice operations, and synchronous syntax validation before writing to disk. LSP's `textDocument/formatting` and `textDocument/documentSymbol` don't expose what's needed here.

A language can have:
- Both (TypeScript, Rust) — full tool surface
- LSP only (e.g. Go initially) — zoom/impact/deps work, find/edit return `PluginUnavailable`
- AST only — find/edit work without LSP intelligence (unusual but valid for embedded grammars)
- Neither — kart ignores files with that extension

### Why not one monolithic plugin

A single plugin interface that requires both capabilities would mean:
- Adding a new language requires implementing an AST parser before LSP tools work, raising the contribution bar unnecessarily
- The interface surface grows with every language-specific quirk (Rust's `isBarrel` has no equivalent; TypeScript's barrel detection doesn't generalize)
- Optional methods signal that the interface isn't well-designed

Two interfaces with independent registration lets languages opt into capabilities incrementally.

## Decision

Define two plugin interfaces (`LspPlugin`, `AstPlugin`) and a `PluginRegistry` service that routes to them by file extension. Tool handlers depend on the registry, not on individual plugins directly.

### Plugin interfaces

```typescript
class LspPlugin extends Context.Tag("LspPlugin")<
  LspPlugin,
  {
    readonly extensions: ReadonlySet<string>
    readonly binary: string
    readonly args: readonly string[]
    readonly languageId: (path: string) => string
    readonly initializeParams: (root: string) => Record<string, unknown>
    readonly watchExtensions: ReadonlySet<string>
    readonly watchFilenames: ReadonlySet<string>
  }
>() {}

class AstPlugin extends Context.Tag("AstPlugin")<
  AstPlugin,
  {
    readonly extensions: ReadonlySet<string>
    readonly parseSymbols: (source: string, path: string) => Symbol[]
    readonly locateSymbol: (source: string, name: string) => Option.Option<ByteRange>
    readonly validateSyntax: (source: string, path: string) => Option.Option<string>
  }
>() {}
```

### PluginRegistry service

The registry maps file extensions to plugin implementations and is the single dependency for all tool handlers. Tool handlers never import concrete plugin implementations — they ask the registry.

```typescript
class PluginRegistry extends Context.Tag("PluginRegistry")<
  PluginRegistry,
  {
    readonly astFor: (path: string) => Option.Option<AstPlugin["Type"]>
    readonly lspFor: (path: string) => Option.Option<LspPlugin["Type"]>
  }
>() {}

const makeRegistry = (
  astPlugins: AstPlugin["Type"][],
  lspPlugins: LspPlugin["Type"][],
): PluginRegistry["Type"] => {
  const astMap = new Map(astPlugins.flatMap(p => [...p.extensions].map(ext => [ext, p])))
  const lspMap = new Map(lspPlugins.flatMap(p => [...p.extensions].map(ext => [ext, p])))
  return {
    astFor: path => Option.fromNullable(astMap.get(extname(path))),
    lspFor: path => Option.fromNullable(lspMap.get(extname(path))),
  }
}
```

The registry layer collects all plugin layers as dependencies:

```typescript
const RegistryLive = Layer.effect(
  PluginRegistry,
  Effect.gen(function*() {
    const tsAst  = yield* TsAstPlugin
    const tsLsp  = yield* TsLspPlugin
    const rustAst = yield* RustAstPlugin
    const rustLsp = yield* RustLspPlugin
    return makeRegistry([tsAst, rustAst], [tsLsp, rustLsp])
  })
).pipe(Layer.provide(
  Layer.mergeAll(TsAstPlugin, TsLspPlugin, RustAstPlugin, RustLspPlugin)
))
```

Adding a language means implementing its plugin layers and adding them to `RegistryLive`. Tool handlers don't change.

### LSP runtime management

Each language's LSP connection needs its own `ManagedRuntime` so failures isolate. Runtimes initialize lazily — rust-analyzer shouldn't spawn until the first `.rs` zoom call. The registry provides the plugin config; `LspRuntimes` manages the lifecycle:

```typescript
class LspRuntimes extends Context.Tag("LspRuntimes")<
  LspRuntimes,
  {
    readonly runtimeFor: (path: string) => Effect.Effect<
      ManagedRuntime.ManagedRuntime<SymbolIndex, never>,
      PluginUnavailableError
    >
  }
>() {}

const LspRuntimesLive = Layer.effect(
  LspRuntimes,
  Effect.gen(function*() {
    const registry = yield* PluginRegistry
    const runtimes = yield* Ref.make(new Map<string, ManagedRuntime.ManagedRuntime<SymbolIndex, never>>())

    return {
      runtimeFor: (path) => Effect.gen(function*() {
        const ext = extname(path)
        const plugin = yield* registry.lspFor(path).pipe(
          Effect.fromOption(() => new PluginUnavailableError({ path }))
        )
        const current = yield* Ref.get(runtimes)
        if (current.has(ext)) return current.get(ext)!

        const runtime = ManagedRuntime.make(
          SymbolIndexLive({ rootDir }).pipe(
            Layer.provide(LspClientLive({ plugin, rootDir }))
          )
        )
        yield* Ref.update(runtimes, m => new Map(m).set(ext, runtime))
        return runtime
      })
    }
  })
).pipe(Layer.provide(RegistryLive))
```

Using `Ref` rather than a mutable `Map` directly makes the state explicit and keeps the service referentially transparent about its effects.

### Tool handler shape

Tool handlers depend on `PluginRegistry` and `LspRuntimes` — never on concrete plugin implementations:

```typescript
// AST-dependent tool
const kart_find_handler = (args: FindArgs) =>
  Effect.gen(function*() {
    const registry = yield* PluginRegistry
    const plugin = yield* registry.astFor(args.path).pipe(
      Effect.fromOption(() => new PluginUnavailableError({ path: args.path, capability: "ast" }))
    )
    return yield* findSymbols(args, plugin)
  })

// LSP-dependent tool
const kart_zoom_handler = (args: ZoomArgs) =>
  Effect.gen(function*() {
    const lspRuntimes = yield* LspRuntimes
    const runtime = yield* lspRuntimes.runtimeFor(args.path)
    return yield* runtime.runPromise(zoomEffect(args))
  })
```

### PluginUnavailableError

When a tool's required capability isn't registered for a file extension, it returns a structured error rather than throwing:

```typescript
class PluginUnavailableError extends Data.TaggedError("PluginUnavailableError")<{
  readonly path: string
  readonly capability: "lsp" | "ast"
}> {}
```

The MCP response layer maps this to a non-error tool result with enough information for the agent to adapt:

```json
{
  "available": false,
  "capability": "ast",
  "extension": ".go",
  "suggestion": "kart_search (ripgrep) is available for pattern search across all file types"
}
```

This is a content response, not `isError: true` — the agent should be able to handle it without treating it as a failure.

### Concrete implementations

**TypeScript** — `TsAstPlugin` wraps `OxcSymbols.ts` (synchronous, native binding). `TsLspPlugin` spawns `typescript-language-server --stdio`.

**Rust** — `RustAstPlugin` uses `Layer.effect` because WASM grammar initialization is async:

```typescript
const RustAstPlugin = Layer.effect(AstPlugin,
  Effect.gen(function*() {
    yield* Effect.promise(() => initRustParser()) // load once at layer build time
    return {
      extensions: new Set([".rs"]),
      parseSymbols: parseRustSymbols,
      locateSymbol: source => Option.fromNullable(locateRustSymbol(source)),
      validateSyntax: source => Option.fromNullable(validateRustSyntax(source)),
    }
  })
)
```

The WASM load happens once when the layer is provided, not on each tool call.

## Consequences

### LSP-only is a valid plugin

A language with an LSP server but no AST plugin gets zoom, impact, deps, and references working immediately. Find and edit return `PluginUnavailable`. This is the right default for adding a new language — LSP tools have broad usefulness and low implementation cost (just spawn config), whereas AST tools require parser integration.

### The interface is stable at two implementations

The current `AstPlugin` interface was designed with TypeScript and Rust in mind. A third language (Go, Python) will either fit cleanly or expose where the interface is wrong. Per ADR-006, the interface is considered stable once three implementations exist. Until then, breaking changes are expected and cheap.

### `isExported` and barrel detection are not in the interface

Both were considered and dropped. `isExported` is LSP-queryable via `documentSymbol` response flags — it doesn't need to be an AST plugin concern. `isBarrel` is TypeScript-specific (re-export-only files) with no general equivalent; it belongs in the TypeScript plugin's internal logic, not the shared interface.

### Plugin registration is compile-time but extensible

Plugins are registered in `RegistryLive` by adding layers. There's no runtime registration (dynamic loading, `kart.config.ts`) yet — that's the natural next step when a community plugin story emerges. The registry service boundary means adding that capability later doesn't require touching tool handlers.

### LspClientLive becomes plugin-parameterized

`LspClientLive` now accepts an `LspPlugin` and uses `plugin.binary`, `plugin.languageId`, etc. This was a mechanical change with no behavioral impact on existing TypeScript tooling.

## Alternatives considered

### Routing at the call site (switch statement)

Route by extension directly in tool handlers via a helper function rather than a registry service. Simpler initially — no `PluginRegistry` layer to wire up. Rejected because it scatters the extension→plugin mapping across handlers, makes testing harder (can't swap the registry for a mock), and provides no clean extension point when runtime registration becomes necessary. The registry pays for itself as soon as there are two languages.

### Monolithic plugin interface

One plugin type that optionally implements both LSP and AST capabilities via optional methods. Rejected — optional methods signal a poorly designed interface, and it raises the contribution bar for LSP-only languages unnecessarily.

## Relationship to other ADRs

- **ADR-004** (per-tool runtime): `LspRuntimes` extends this principle to per-language — each language's LSP connection is an independent `ManagedRuntime`.
- **ADR-005** (edit tools): the `AstPlugin` interface is the generalization of the TypeScript-specific edit pipeline described there. `locateSymbol` and `validateSyntax` map directly to `AstEdit.ts` functions.
- **ADR-006** (multi-language): this ADR records the interface that ADR-006 deferred to phase 2. Implementation phases are unchanged — build rust in kart directly, then extract to packages once the interface is stable.
