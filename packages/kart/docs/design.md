# kart — design document v0.5

> For implementation details (module map, service internals, data flow), see [architecture.md](architecture.md).

## 1. problem statement

### 1.1 the context budget problem

Agents have a fixed context window. Loading entire files is wasteful — most of the content isn't relevant to the current task. Loading nothing forces the agent to guess. The right answer is progressive disclosure: start shallow, drill only where needed.

The context budget problem is a retrieval problem with a depth dimension: the agent needs to decide how deep to go *before* loading content, based on how relevant the file is to the current task.

### 1.2 the impact gap

When an agent modifies a symbol, it needs to know what else might break. "What does this affect?" isn't the same as "what references this?" — the latter is one level deep, the former is transitive.

No tool answers transitive impact as a single query: "if I change `parseConfig`, what's the full blast radius?"

### 1.3 the behavioral gap

Static analysis (imports, references, type hierarchies) reveals structural coupling. It misses behavioral coupling — files that change together in practice because of implicit contracts, shared schemas, or conventions invisible to the type system.

Kiste's co-change graph captures this signal. But the signal isn't surfaced at the point of code navigation — there's no tool that answers "when I touch this file, what else typically needs to change?"

---

## 2. what kart is

Kart is a coding toolkit for AI agents — built on oxc/tree-sitter and LSP rather than python.

The tool surface covers four concerns:

1. **navigation** — find symbols, list files, search patterns, progressive disclosure of file structure
2. **analysis** — transitive impact, downstream dependencies, behavioral coupling, diagnostics
3. **editing** — symbol-level insert, replace, and reference-aware rename
4. **verification** — inline lint on edit, on-demand type-aware diagnostics

Supports TypeScript (oxc-parser + typescript-language-server) and Rust (tree-sitter + rust-analyzer). Multi-language support follows ADR-006: build each language in kart first, extract the plugin interface from concrete implementations.

---

## 3. architecture

### 3.1 three backends, one tool surface

Kart uses three backends depending on what's needed:

**oxc** — for TS diagnostics, zoom levels, symbol index, and editing. Synchronous, per-file, no process lifecycle. Oxlint with `--type-aware` shells out to the oxlint+tsgolint binary pair. Fast, reliable, no connection management.

**tree-sitter** — for Rust symbol extraction. WASM-based (`web-tree-sitter`), no native bindings. Parses `function_item`, `struct_item`, `enum_item`, `trait_item`, `impl_item`, `type_item`, `const_item`, `static_item`, `mod_item`, `macro_definition`. Returns the same `OxcSymbol` shape for compatibility.

**LSP** — for cross-file type resolution. `typescript-language-server` for TS, `rust-analyzer` for Rust. Parameterized via `LanguageServerConfig` (binary, args, languageId, watch patterns). LSP-backed tools route by file extension.

The split is clean: if a tool needs to cross file boundaries for type information, use LSP. For per-file parsing, use oxc (TS) or tree-sitter (Rust).

### 3.2 runtime architecture

Kart uses **per-tool runtimes** rather than a single shared runtime. Each MCP tool gets its own Effect `ManagedRuntime` with only the services it needs:

```
McpServer
  ├─ cochangeRuntime → CochangeDb (bun:sqlite, read-only)
  ├─ zoomRuntime     → SymbolIndex → LspClient (typescript-language-server)
  └─ rustRuntime     → SymbolIndex → LspClient (rust-analyzer)  [lazy]
```

This means `kart_cochange` works even when a language server fails to start. `rustRuntime` is created lazily on first `.rs` tool call — if `rust-analyzer` isn't installed, TS tools still work. See ADR-004.

### 3.3 language server connection

Kart manages persistent language server processes per workspace, parameterized via `LanguageServerConfig`:

- **init**: on first call needing LSP, spawn the configured binary, perform the handshake, cache the connection
- **warm**: subsequent calls reuse the connection — no per-query startup cost
- **release**: close open documents, send `shutdown` request → `exit` notification, kill process

Two built-in configs: `tsLanguageServer` (typescript-language-server --stdio) and `rustLanguageServer` (rust-analyzer). Each config specifies binary, args, languageId mapping, and file watch patterns.

**Binary resolution:** `node_modules/.bin/<binary>` first, `Bun.which()` fallback.

**JSON-RPC transport:** `JsonRpcTransport` handles Content-Length framing with a `Uint8Array` byte buffer (Content-Length counts bytes, not characters). Request/response correlation via incrementing integer IDs.

**File watching:** A recursive `fs.watch` monitors extensions and filenames from the config (e.g. `*.ts`/`tsconfig.json` for TS, `*.rs`/`Cargo.toml` for Rust). Watcher errors silently ignored — stale state is an acceptable fallback.

### 3.4 zoom levels

Three levels of disclosure for a file:

| level | content | when to use |
|-------|---------|-------------|
| 0 | exported symbols + type signatures + doc comments | default — "what does this module expose?" |
| 1 | all symbols + type signatures + doc comments | understanding internals — "how does this module work?" |
| 2 | full file content (capped at 100KB) | full context needed — "I need to read the implementation" |

Export detection uses text scanning — `export ` for TS, `pub `/`pub(` for Rust. Simple, deterministic, accurate for standard patterns. Semantic tokens were evaluated and rejected: LSP semantic token modifiers do not distinguish exports.

**Resolved types:** Levels 0 and 1 enrich each symbol with `resolvedType` — the LSP hover result stripped of markdown formatting. This gives agents the compiler's view (inferred return types, expanded type aliases) without a separate tool call. Hover calls average 2-10ms per symbol after warmup. The `resolveTypes` param (default `true`) allows opt-out for fast scanning.

**Directory zoom:** when `path` is a directory, behavior depends on level:
- **Level 0** (default): compact summary — file name + export count via oxc-parser (no LSP, fast). Ideal for browsing unfamiliar packages.
- **Level 1+**: full symbol signatures with LSP-resolved types.

Non-recursive, test files excluded. Files with no exports are omitted in both modes.

### 3.5 transitive impact and deps

`kart_impact` computes the transitive closure of callers via BFS over LSP `incomingCalls`. `kart_deps` is the inverse — BFS over `outgoingCalls` to find transitive callees. Together they give a complete view of a symbol's neighborhood.

Both use: depth default 3, hard cap `MAX_IMPACT_DEPTH` = 5. Visited set prevents cycles. `highFanOut` flag when any node exceeds `HIGH_FAN_OUT_THRESHOLD` = 10 direct connections.

Latency: ~350ms cold start (LSP initialization), then 3–5ms per hop. Depth-3 BFS completes in <500ms on typical codebases.

### 3.6 diagnostics (phase 4)

`kart_diagnostics` shells out to `oxlint --type-aware --format json [paths]`. Oxlint's type-aware mode uses tsgolint (powered by tsgo) — 43+ rules covering the high-value typescript-eslint surface including `no-floating-promises`, `no-unsafe-assignment`, `no-misused-promises`.

As of the alpha release, tsgolint also emits typescript type-checking errors alongside lint rules, potentially eliminating `tsc --noEmit`.

**Alpha caveat:** memory issues on very large monorepos are a known limitation. If oxlint fails, kart surfaces the error as a structured response.

### 3.7 symbol search (phase 5)

`kart_find` scans the workspace with an in-memory mtime cache. First call collects all `.ts`/`.tsx`/`.rs` files recursively (excludes `node_modules`/`dist`/`build`/`.git`/`.varp`/`target`), parses each in parallel (oxc for TS, tree-sitter for Rust), and caches results keyed by path + mtime. Subsequent calls only re-parse files whose mtime changed, making warm queries near-instant. Deleted files are evicted automatically. `kart_restart` clears the cache. The Rust parser is initialized lazily on first `.rs` encounter.

### 3.8 symbol-level editing (phase 6, ADR-005)

Kart edits files at the symbol level using parser ASTs to locate precise source ranges:

```
1. parse file with oxc (TS) or tree-sitter (Rust) → get AST
2. find symbol by name → get source range (start, end byte offsets)
3. validate new content: parse with oxc/tree-sitter → reject if syntax error (no disk write)
4. splice: prefix + new content + suffix → write file
5. run oxlint on changed file → return diagnostics inline
```

Step 3 catches malformed edits before they hit disk. Step 5 gives the agent immediate feedback without a separate tool call. `syntaxError: true` means the file was not modified — the agent retries with corrected content. For Rust files, syntax validation uses tree-sitter's `rootNode.hasError` (best-effort — catches missing braces, unclosed strings). The Rust parser is initialized lazily on first `.rs` edit.

This crosses kart from read-only to read-write. See ADR-005 for the full decision record and consequences.

### 3.9 import graph

`kart_imports(path)` returns what a file imports: raw specifiers, resolved absolute paths, imported symbol names, and type-only status. Uses oxc AST for extraction and `Bun.resolveSync` for tsconfig-aware resolution.

`kart_importers(path)` returns all files that import the given file. Barrel files (index.ts that only re-export) are expanded transparently — if `auth/index.ts` re-exports from `auth/session.ts`, then `kart_importers("auth/session.ts")` includes files that import via the barrel.

Both tools are stateless (no LSP, no Effect runtime). The workspace import graph is built on-demand per request — oxc parsing + Bun resolution is fast enough that caching isn't needed at typical codebase sizes.

### 3.10 behavioral coupling

`kart_cochange` queries kiste's co-change sqlite database at `.varp/cochange.db`. Returns files that most frequently change alongside the queried file, ranked by co-change weight.

If the database is absent, returns a structured `CochangeUnavailable` response (not an error) — the agent knows what to do next.

**Naming:** `kart_cochange` (not `kart_coupling`) to avoid collision with varp's `varp_coupling` which operates on component-level structural coupling from the manifest.

---

## 4. MCP tools

### shipped

| tool | purpose | backend |
|------|---------|---------|
| `kart_zoom` | progressive disclosure of file/directory structure | LSP `documentSymbol` + text scan |
| `kart_cochange` | co-change neighbors from git history | kiste sqlite |
| `kart_impact` | transitive callers (blast radius) | LSP `incomingCalls` |
| `kart_deps` | transitive callees (dependencies) | LSP `outgoingCalls` |
| `kart_find` | workspace symbol index search | oxc-parser |
| `kart_search` | pattern search | ripgrep subprocess |
| `kart_list` | directory listing (gitignore-aware) | fs |
| `kart_replace` | replace full symbol definition | oxc (TS) / tree-sitter (Rust) + oxfmt/rustfmt + oxlint |
| `kart_insert_after` | insert content after symbol | oxc (TS) / tree-sitter (Rust) + oxfmt/rustfmt + oxlint |
| `kart_insert_before` | insert content before symbol | oxc (TS) / tree-sitter (Rust) + oxfmt/rustfmt + oxlint |
| `kart_diagnostics` | lint violations + type errors | oxlint (TS) / cargo clippy (Rust) |
| `kart_references` | cross-file references | LSP `textDocument/references` |
| `kart_rename` | reference-aware rename | LSP `textDocument/rename` |
| `kart_imports` | file import list with resolved paths | oxc-parser (TS) / tree-sitter (Rust) |
| `kart_importers` | reverse import lookup with barrel expansion | oxc-parser (TS) / tree-sitter (Rust) |

| `kart_definition` | go to definition of a symbol | LSP `textDocument/definition` |
| `kart_type_definition` | go to type definition | LSP `textDocument/typeDefinition` |
| `kart_implementation` | find implementations of interface/trait | LSP `textDocument/implementation` |
| `kart_code_actions` | available code actions at symbol position | LSP `textDocument/codeAction` |
| `kart_expand_macro` | expand Rust macro | `rust-analyzer/expandMacro` |
| `kart_unused_exports` | find exported symbols with no importers | oxc-parser (TS) / tree-sitter (Rust) |
| `kart_inlay_hints` | inferred types and parameter names | LSP `textDocument/inlayHint` |
| `kart_workspace_symbol` | search workspace symbols by name | LSP `workspace/symbol` |
| `kart_restart` | restart all language servers + clear caches | — |

---

## 5. relationship to serena

Kart is a full serena replacement for typescript projects.

| serena tool | kart equivalent | status |
|------------|----------------|--------|
| `get_symbols_overview` | `kart_zoom` level-0 | shipped |
| `find_symbol` | `kart_find` | shipped |
| `find_referencing_symbols` | `kart_references` | shipped |
| `replace_symbol_body` | `kart_replace` | shipped |
| `insert_after_symbol` | `kart_insert_after` | shipped |
| `insert_before_symbol` | `kart_insert_before` | shipped |
| `search_for_pattern` | `kart_search` | shipped |
| `list_dir` | `kart_list` | shipped |
| `find_file` | `kart_list` with glob | shipped |
| `restart_language_server` | `kart_restart` | shipped |
| `rename_symbol` | `kart_rename` | shipped |

Serena tools kart deliberately omits: memory system (`write_memory` etc.), onboarding, reasoning scaffolding (`think_about_*`), mode switching. These are workflow conventions, not code intelligence primitives. Agents using kart manage context via varp manifests and kiste artifacts.

For languages not yet supported (python, go), serena remains the right choice.

---

## 6. relationship to varp and kiste

Kart is independent of varp. It doesn't require `varp.yaml` or any varp concepts.

Kart integrates with kiste optionally via sqlite. Kiste builds the co-change graph; kart queries it. Neither depends on the other at the package level — the integration is file-based (`.varp/cochange.db`).

```
varp    — architectural manifest, dependency graph, agent orchestration
kiste   — semantic artifact storage, git history, behavioral coupling data
kart    — code intelligence, progressive disclosure, impact analysis
```

Varp and kiste share the `.varp/` directory convention. Kart reads from it but doesn't own it.

---

## 7. delivery

Kart is an MCP server delivered as an npm package (`@vevx/kart`). Configuration in `.mcp.json`:

```json
{
  "mcpServers": {
    "kart": {
      "command": "bun",
      "args": ["packages/kart/dist/Mcp.js"]
    }
  }
}
```

Language servers are managed internally. Kart finds `typescript-language-server` and `rust-analyzer` via `node_modules/.bin/` or `Bun.which()` fallback.

Oxlint type-aware linting (phase 4) requires `oxlint-tsgolint` in the workspace. If absent, `kart_diagnostics` returns `{ oxlintAvailable: false }` — structured degradation, not an error.

---

## 8. roadmap

| phase | scope | status |
|-------|-------|--------|
| 0 | `kart_zoom`, `kart_cochange` | shipped |
| 1 | LSP call hierarchy plumbing, latency spike | shipped |
| 2 | `kart_impact`, file watcher | shipped |
| 3 | `kart_deps` | shipped |
| 4 | `kart_diagnostics` via oxlint `--type-aware` | shipped |
| 5 | `kart_find`, `kart_search`, `kart_list` | shipped |
| 6 | `kart_replace`, `kart_insert_after`, `kart_insert_before` (ADR-005) | shipped |
| 7 | `kart_references` via LSP `textDocument/references` | shipped |
| 8 | `kart_rename` via LSP `textDocument/rename` | shipped |
| 9 | `kart_imports`, `kart_importers` via oxc + Bun.resolveSync | shipped |
| 10 | `kart_unused_exports`, `kart_restart` | shipped |
| 11 | Rust support — tree-sitter + rust-analyzer (ADR-006 Phase 1) | shipped |
| 12 | `kart_definition`, `kart_type_definition`, `kart_implementation`, `kart_code_actions`, `kart_expand_macro` | shipped |
| 13 | `kart_inlay_hints`, post-edit formatting (`format` param on edit tools) | shipped |
| 14 | Rust imports (`kart_imports`/`kart_importers` for `.rs`), `kart_workspace_symbol`, file watcher cache invalidation | shipped |

---

## 9. design decisions

### edit tools cross the read-write boundary (ADR-005)

Read-only tools are safely retryable. Write tools are not idempotent. The inline lint on edit partially addresses this — the agent learns immediately if the edit introduced problems. But behavioral correctness requires acceptance verification, not just lint.

See `docs/decisions/adr-005-kart-edit-tools` for the full decision record.

### edit tools support TS and Rust

The edit tools (`kart_replace`, `kart_insert_after`, `kart_insert_before`) use oxc's AST for TypeScript and tree-sitter for Rust. Both parsers produce the same `OxcSymbol` shape with byte-offset ranges, so the splice functions are language-agnostic. Rust syntax validation uses tree-sitter's `rootNode.hasError` (best-effort).

### per-tool runtimes (ADR-004)

Each tool gets its own `ManagedRuntime`. LSP failure doesn't block cochange queries. See `docs/decisions/adr-004-per-tool-runtime`.

### lazy symbol index over incremental

Full reindex on dirty rather than tracking changed files. Oxc parsing is fast enough that the complexity of incremental doesn't pay for itself at typical codebase sizes.

### text scanning for export detection

LSP semantic tokens do not distinguish exports (validated empirically). Text scanning (`export` keyword on declaration line) is simple, deterministic, and accurate for standard patterns.

---

## 10. naming

**kart** is Norwegian for "map." A map gives you orientation — where things are, how they connect, what's nearby — without loading the entire territory. You zoom in on what matters.

The toolkit: kart is the map, kiste is the chest of artifacts, varp is the warp threads holding the structure together.
