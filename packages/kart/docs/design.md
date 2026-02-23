# kart — design document v0.5

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

Kart is a complete typescript coding toolkit for AI agents — a serena replacement scoped to typescript, built on oxc and LSP rather than python.

The tool surface covers four concerns:

1. **navigation** — find symbols, list files, search patterns, progressive disclosure of file structure
2. **analysis** — transitive impact, downstream dependencies, behavioral coupling, diagnostics
3. **editing** — symbol-level insert, replace, and reference-aware rename
4. **verification** — inline lint on edit, on-demand type-aware diagnostics

For typescript projects, no other tool is needed. For other languages, serena remains the right choice.

---

## 3. architecture

### 3.1 two backends, one tool surface

Kart uses two backends depending on what's needed:

**oxc** — for diagnostics, zoom levels, symbol index, and editing. Synchronous, per-file, no process lifecycle. Oxlint with `--type-aware` shells out to the oxlint+tsgolint binary pair, which uses tsgo internally. Fast, reliable, no connection management.

**LSP (typescript-language-server)** — for impact, deps, and references. Cross-file type resolution is the one thing oxc can't do. `kart_impact` and `kart_deps` require the full typescript type graph, which only the language server has.

The split is clean: if a tool needs to cross file boundaries for type information, use LSP. Otherwise, use oxc.

### 3.2 runtime architecture

Kart uses **per-tool runtimes** rather than a single shared runtime. Each MCP tool gets its own Effect `ManagedRuntime` with only the services it needs:

```
McpServer
  ├─ cochangeRuntime → CochangeDb (bun:sqlite, read-only)
  └─ zoomRuntime     → SymbolIndex → LspClient (typescript-language-server)
```

This means `kart_cochange` works even when the language server fails to start. LSP startup failure is the most likely failure mode — isolating it prevents one broken tool from taking down the other. See ADR-004.

### 3.3 language server connection

Kart manages a persistent typescript-language-server process per workspace:

- **init**: on first call needing LSP, spawn `typescript-language-server --stdio`, perform the handshake, cache the connection
- **warm**: subsequent calls reuse the connection — no per-query startup cost
- **release**: close open documents, send `shutdown` request → `exit` notification, kill process

**Binary resolution:** `node_modules/.bin/typescript-language-server` first, `Bun.which()` fallback.

**JSON-RPC transport:** `JsonRpcTransport` handles Content-Length framing with a `Uint8Array` byte buffer (Content-Length counts bytes, not characters). Request/response correlation via incrementing integer IDs.

**File watching:** A recursive `fs.watch` on the workspace root monitors `*.ts`, `*.tsx`, `tsconfig.json`, and `package.json`. On change, sends `workspace/didChangeWatchedFiles` to the LS. Watcher errors (e.g. EMFILE) are silently ignored — stale state is an acceptable fallback.

### 3.4 zoom levels

Three levels of disclosure for a file:

| level | content | when to use |
|-------|---------|-------------|
| 0 | exported symbols + type signatures + doc comments | default — "what does this module expose?" |
| 1 | all symbols + type signatures + doc comments | understanding internals — "how does this module work?" |
| 2 | full file content (capped at 100KB) | full context needed — "I need to read the implementation" |

Export detection uses text scanning (`export` keyword on declaration line) — simple, deterministic, accurate for standard typescript including re-exports and barrel files. Semantic tokens were evaluated and rejected: LSP semantic token modifiers do not distinguish exports.

**Directory zoom:** when `path` is a directory, returns level-0 for each `.ts`/`.tsx` file (non-recursive, test files excluded). Files with no exports are omitted.

### 3.5 transitive impact and deps

`kart_impact` computes the transitive closure of callers via BFS over LSP `incomingCalls`. `kart_deps` is the inverse — BFS over `outgoingCalls` to find transitive callees. Together they give a complete view of a symbol's neighborhood.

Both use: depth default 3, hard cap `MAX_IMPACT_DEPTH` = 5. Visited set prevents cycles. `highFanOut` flag when any node exceeds `HIGH_FAN_OUT_THRESHOLD` = 10 direct connections.

Latency: ~350ms cold start (LSP initialization), then 3–5ms per hop. Depth-3 BFS completes in <500ms on typical codebases.

### 3.6 diagnostics (phase 4)

`kart_diagnostics` shells out to `oxlint --type-aware --format json [paths]`. Oxlint's type-aware mode uses tsgolint (powered by tsgo) — 43+ rules covering the high-value typescript-eslint surface including `no-floating-promises`, `no-unsafe-assignment`, `no-misused-promises`.

As of the alpha release, tsgolint also emits typescript type-checking errors alongside lint rules, potentially eliminating `tsc --noEmit`.

**Alpha caveat:** memory issues on very large monorepos are a known limitation. If oxlint fails, kart surfaces the error as a structured response.

### 3.7 symbol index (phase 5)

`kart_find` queries a workspace-wide symbol index stored in `.varp/symbols.db`. The index is built by parsing every typescript file with oxc, extracting all symbols (name, kind, file, line, exported).

**Rebuild strategy:** lazy. The file watcher marks the index dirty on any file change. Full reindex on dirty — oxc parsing is fast enough that incremental tracking adds complexity without meaningful speedup.

```sql
-- symbols.db schema
symbols (id, name, kind, path, line, exported)
symbols_fts (FTS5 over name)
meta (last_indexed_sha, dirty)
```

### 3.8 symbol-level editing (phase 6, ADR-005)

Kart edits files at the symbol level using oxc's AST to locate precise source ranges:

```
1. parse file with oxc → get AST
2. find symbol by name → get source range (start, end byte offsets)
3. validate new content: parse with oxc → reject if syntax error (no disk write)
4. splice: prefix + new content + suffix → write file
5. run oxlint on changed file → return diagnostics inline
```

Step 3 catches malformed edits before they hit disk. Step 5 gives the agent immediate feedback without a separate tool call. `syntaxError: true` means the file was not modified — the agent retries with corrected content.

This crosses kart from read-only to read-write. See ADR-005 for the full decision record and consequences.

### 3.9 behavioral coupling

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
| `kart_replace` | replace full symbol definition | oxc AST + oxlint |
| `kart_insert_after` | insert content after symbol | oxc AST + oxlint |
| `kart_insert_before` | insert content before symbol | oxc AST + oxlint |
| `kart_diagnostics` | lint violations + type errors | oxlint `--type-aware` |
| `kart_references` | cross-file references | LSP `textDocument/references` |
| `kart_rename` | reference-aware rename | LSP `textDocument/rename` |

### future

| tool | purpose | backend |
|------|---------|---------|
| `kart_restart` | restart language server | — |

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
| `restart_language_server` | `kart_restart` | future |
| `rename_symbol` | `kart_rename` | shipped |

Serena tools kart deliberately omits: memory system (`write_memory` etc.), onboarding, reasoning scaffolding (`think_about_*`), mode switching. These are workflow conventions, not code intelligence primitives. Agents using kart manage context via varp manifests and kiste artifacts.

For non-typescript projects (python, rust, go), serena remains the right choice.

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

The language server is managed internally. Kart finds `typescript-language-server` via `node_modules/.bin/` or `Bun.which()` fallback.

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

---

## 9. design decisions

### edit tools cross the read-write boundary (ADR-005)

Read-only tools are safely retryable. Write tools are not idempotent. The inline lint on edit partially addresses this — the agent learns immediately if the edit introduced problems. But behavioral correctness requires acceptance verification, not just lint.

See `docs/decisions/adr-005-kart-edit-tools` for the full decision record.

### typescript only for edits

The edit tools use oxc's AST, which is typescript/javascript only. For non-typescript projects, serena remains the right choice. This is a documented boundary, not a temporary limitation.

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
