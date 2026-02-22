# kart
## design document — v0.3 (post-implementation)

---

## 1. problem statement

### 1.1 the context budget problem

agents have a fixed context window. loading entire files is wasteful — most of the content isn't relevant to the current task. loading nothing forces the agent to guess. the right answer is progressive disclosure: start shallow, drill only where needed.

existing tools don't solve this. serena's `get_symbols_overview` gives you all top-level symbols in a file — a flat list with no hierarchy of relevance. reading the full file loads everything. neither gives you "just the public contract of this module."

the context budget problem is a retrieval problem with a depth dimension: the agent needs to decide how deep to go *before* loading content, based on how relevant the file is to the current task.

### 1.2 the impact gap

when an agent modifies a symbol, it needs to know what else might break. the question "what does this affect?" isn't the same as "what references this?" — the latter is one level deep. the former is transitive.

serena provides `find_referencing_symbols` (direct references). no tool currently answers transitive impact as a single query: "if i change `parseConfig`, what's the full blast radius?"

### 1.3 the behavioral gap

static analysis (imports, references, type hierarchies) reveals structural coupling. it misses behavioral coupling — files that change together in practice because of implicit contracts, shared schemas, or conventions invisible to the type system.

kiste's co-change graph captures this signal. but the signal isn't surfaced at the point of code navigation — there's no tool that answers "when i touch this file, what else typically needs to change?"

---

## 2. what kart is

kart is a thin code intelligence layer providing three things serena doesn't:

1. **zoom levels** — progressive disclosure of a file or directory's structure, from public contract to full implementation
2. **transitive impact** — "what does changing this symbol affect?" as a single query
3. **behavioral coupling** — co-change neighborhood from kiste's graph, surfaced during navigation

kart is not a replacement for serena. serena handles symbol search, references, type hierarchies, and editing. kart handles context management and architectural impact. use both.

---

## 3. architecture

### 3.1 runtime architecture

kart uses **per-tool runtimes** rather than a single shared runtime. each MCP tool gets its own Effect `ManagedRuntime` with only the services it needs:

```
McpServer
  ├─ cochangeRuntime → CochangeDb (bun:sqlite, read-only)
  └─ zoomRuntime     → SymbolIndex → LspClient (typescript-language-server)
```

this means `kart_cochange` works even when the language server fails to start (missing typescript, wrong workspace, etc.). LSP startup failure is the most likely failure mode — isolating it prevents one broken tool from taking down the other. see ADR-004 for the full rationale.

### 3.2 language server layer

kart manages a persistent `typescript-language-server` process per workspace. the `LspClient` service handles JSON-RPC framing over stdio with a `Uint8Array` byte buffer (Content-Length counts bytes, not characters).

the lifecycle uses Effect's `Layer.scoped` + `Scope.addFinalizer`:

- **acquire**: find binary (`node_modules/.bin/` first, global fallback), spawn via `Bun.spawn`, LSP initialize handshake, send `initialized` notification
- **warm**: subsequent calls reuse the connection — no per-query startup cost
- **release**: close open documents, send `shutdown` request → `exit` notification, kill process

**file watching (deferred to v0.2).** the design originally called for `workspace/didChangeWatchedFiles` registration during handshake. implementation revealed this is non-trivial: the client must implement its own file watcher (e.g., `fs.watch`) and forward change notifications to the LS. until v0.2 ships this, the LS may have stale state after external edits. agents should be aware that symbol data may lag behind recent file changes. a future version could add staleness detection (e.g., compare file mtimes to LS initialization time).

kart's MCP tools take file paths, not LSP positions. internally, kart converts paths to `file://` URIs and uses `textDocument/didOpen` to register files with the LS before querying them.

### 3.3 zoom levels

three levels of disclosure for a file:

| level | content | when to use |
|-------|---------|-------------|
| 0 | exported symbols + type signatures + doc comments | default — "what does this module expose?" |
| 1 | all symbols + type signatures + doc comments | understanding internals — "how does this module work?" |
| 2 | full file content | full context needed — "i need to understand or modify the implementation" |

level-0 is the default and the primary value prop. it answers "what is this module's contract?" without loading implementation details. for a well-typed typescript file, level-0 gives an agent everything it needs to *use* the module correctly.

**export detection.** `textDocument/documentSymbol` returns the hierarchical symbol tree but doesn't directly indicate which symbols are exported.

the v0.2 design proposed using LSP semantic tokens (`textDocument/semanticTokens/full`) to identify export modifiers, with text scanning as a fallback. a phase-0 spike tested this empirically and found that **semantic tokens do not distinguish exports**. the standard LSP semantic token modifiers (`declaration`, `definition`, `readonly`, `static`, `deprecated`, `abstract`, `async`, `modification`, `documentation`, `defaultLibrary`) do not include anything related to export status. the typescript-language-server does not add custom modifiers either. exported and non-exported symbols receive identical modifier bitmasks (typically just `["declaration"]`).

kart uses **text scanning**: for each symbol from `documentSymbol`, check if the line at `symbol.range.start.line` starts with `export ` (after trimming whitespace). this is implemented as a pure function `isExported(symbol, lines)` in `src/pure/ExportDetection.ts`. the approach is simple, deterministic, and handles all standard patterns: `export function`, `export const`, `export class`, `export interface`, `export type`, and `export default`. re-exports (`export { X } from`) don't appear as `documentSymbol` entries, so they require no special handling.

level-0 output format:

```
// auth/session.ts — public interface

export function createSession(userId: string, ttl: number): Promise<Session>
/** Creates a new session. ttl is in seconds. */

export interface Session {
  id: string
  userId: string
  expiresAt: Date
}

export class SessionError extends Error { ... }
```

the `...` placeholder on class bodies signals "implementation present, not loaded." the agent can request level-1 or level-2 if it needs more.

**directory zoom.** when `path` is a directory, `kart_zoom` returns level-0 for each file in the directory (non-recursive). this answers "what does this module expose?" at the directory level — the aggregate public contract across a module boundary. files with no exports are omitted from the result.

### 3.4 transitive impact (phase 2)

`kart_impact` computes the transitive closure of callers via BFS over LSP:

```
kart_impact("parseConfig")
  → incomingCalls("parseConfig")          # direct callers: [loadConfig, reloadConfig]
  → incomingCalls("loadConfig")           # callers of callers: [bootstrap, hot-reload]
  → incomingCalls("reloadConfig")         # [hot-reload] — already seen, stop
  → incomingCalls("bootstrap")            # [main] — depth limit
```

result is a tree (or DAG if there's fan-in), not a flat list. depth defaults to 3, configurable.

**latency risk.** each LSP `callHierarchy/incomingCalls` call is a round-trip to the language server. a 3-deep BFS with fan-out of 5 means ~155 calls. on large codebases this could take seconds to minutes. the phase-1 research spike must answer: is live BFS viable, or does kart need to pre-compute and cache the call graph? this is the make-or-break question for `kart_impact` — if live traversal is too slow, the tool becomes a pre-computed index queried at read time, which changes the architecture significantly.

### 3.5 behavioral coupling via kiste

`kart_cochange` queries kiste's co-change sqlite database at `.varp/cochange.db`:

```sql
select b.path, sum(e.weight) as coupling_score
from co_change_edges e
join artifacts a on e.artifact_a = a.id
join artifacts b on e.artifact_b = b.id
where a.path = ?
group by b.path
order by coupling_score desc
limit 20
```

returns the files that most frequently change alongside the queried file, ranked by co-change weight.

if `.varp/cochange.db` is absent, the tool returns a structured message:

```json
{
  "error": "co_change_data_unavailable",
  "message": "co-change data not found. run `varp coupling --build` to generate it, then retry.",
  "path": ".varp/cochange.db"
}
```

this is not a tool error — it's a structured response the agent can act on. the agent knows what to do next.

**naming.** this tool is `kart_cochange` (not `kart_coupling`) to avoid collision with varp's existing `varp_coupling` MCP tool. varp_coupling operates on component-level structural coupling from the manifest; kart_cochange operates on file-level behavioral coupling from git history. different data, different granularity, complementary signals.

---

## 4. mcp tools

### `kart_zoom`

```typescript
kart_zoom(path: string, level?: 0 | 1 | 2): ZoomResult
```

returns a structured view of a file (or directory) at the requested zoom level. level defaults to 0.

when `path` is a directory, returns level-0 for each file in the directory. files with no exports are omitted.

```typescript
interface ZoomResult {
  path: string
  level: 0 | 1 | 2
  symbols: Symbol[]
  truncated: boolean  // true if level < 2 and implementation bodies were omitted
  files?: ZoomResult[]  // present when path is a directory
}

interface Symbol {
  name: string
  kind: string         // "function" | "class" | "interface" | "type" | "const" | ...
  signature: string    // full type signature
  doc: string | null   // tsdoc comment if present
  exported: boolean
  children?: Symbol[]  // for classes/interfaces
}
```

### `kart_cochange`

```typescript
kart_cochange(path: string): CochangeResult | CochangeUnavailable
```

returns co-change neighbors ranked by coupling score.

```typescript
interface CochangeResult {
  path: string
  neighbors: { path: string; score: number; commits: number }[]
}

interface CochangeUnavailable {
  error: "co_change_data_unavailable"
  message: string
  path: string
}
```

### `kart_impact` (phase 2)

```typescript
kart_impact(symbol: string, depth?: number): ImpactResult
```

returns the transitive caller tree up to `depth` levels (default 3).

```typescript
interface ImpactResult {
  symbol: string
  callers: ImpactNode[]
}

interface ImpactNode {
  name: string
  location: { path: string; line: number }
  callers: ImpactNode[]  // recursive — depth-limited
}
```

---

## 5. relationship to serena

kart and serena address different questions:

| question | tool |
|---------|------|
| "where is `UserService` defined?" | serena `find_symbol` |
| "what references `UserService`?" | serena `find_referencing_symbols` |
| "what subtypes implement `UserRepository`?" | serena `jet_brains_type_hierarchy` |
| "what does `auth/session.ts` expose?" | kart `kart_zoom` level-0 |
| "what does the `auth/` directory expose?" | kart `kart_zoom` on directory |
| "what would break if i change `parseConfig`?" | kart `kart_impact` |
| "what else typically changes when i touch `auth/session.ts`?" | kart `kart_cochange` |

install both. serena navigates. kart manages context and surfaces impact.

---

## 6. relationship to varp and kiste

kart is independent of varp. it doesn't require `varp.yaml` or any varp concepts.

kart integrates with kiste optionally via the sqlite cache. kiste builds the co-change graph; kart queries it. neither depends on the other at the package level — the integration is file-based (`.varp/cochange.db`).

the three tools compose naturally but can be used independently:

```
varp    — architectural manifest, dependency graph, agent orchestration
kiste   — semantic artifact storage, git history, behavioral coupling data
kart    — code intelligence, progressive disclosure, impact analysis
```

varp and kiste share the `.varp/` directory convention. kart reads from it but doesn't own it.

---

## 7. delivery

kart is an MCP server delivered as an npm package (`@vevx/kart`). configuration in `.mcp.json`:

```json
{
  "mcpServers": {
    "kart": {
      "command": "npx",
      "args": ["@vevx/kart", "--workspace", "."]
    }
  }
}
```

the language server process is managed internally. users don't configure it — kart finds `typescript-language-server` via the workspace's `node_modules/.bin/` or falls back to a global install.

---

## 8. module structure

kart separates pure computation from effectful services at the directory level:

```
src/
  pure/                     — deterministic, no IO, no Effect services
    types.ts                — DocumentSymbol, LspRange, ZoomSymbol, ZoomResult
    Errors.ts               — Data.TaggedError types (LspError, LspTimeoutError, FileNotFoundError)
    ExportDetection.ts      — isExported(symbol, lines) text scanner
    Signatures.ts           — extractSignature, extractDocComment, findBodyOpenBrace, symbolKindName
  Lsp.ts                    — LspClient service (subprocess, JSON-RPC, Effect Layer)
  Symbols.ts                — SymbolIndex service (imports pure functions from pure/)
  Cochange.ts               — CochangeDb service (bun:sqlite)
  Tools.ts                  — MCP tool definitions (Zod schemas + Effect handlers)
  Mcp.ts                    — server entrypoint, per-tool ManagedRuntime
```

the `pure/` directory is the testing contract boundary. modules in `pure/` are deterministic and testable without mocking — coverage thresholds are enforced on these modules. effectful modules (LSP integration, SQLite, MCP transport) have integration tests without coverage gates.

**CI commands:**

- `test:pure` — runs `src/pure/` tests with `--coverage` (24 tests, 100% line coverage on ExportDetection and Signatures)
- `test:integration` — runs `src/*.test.ts` integration tests without coverage (25 tests, LSP-dependent tests skipped via `describe.skipIf(!hasLsp)`)
- `test` — runs both sequentially

**coverage (phase 0):**

| module | functions | lines |
|--------|-----------|-------|
| pure/ExportDetection.ts | 100% | 100% |
| pure/Signatures.ts | 100% | 100% |
| Symbols.ts | 94% | 100% |
| Cochange.ts | 80% | 100% |
| Lsp.ts | 70% | 92% |
| Mcp.ts | 88% | 89% |
| **all files** | **79%** | **94%** |

Lsp.ts has the lowest coverage — the uncovered paths are error recovery branches (malformed JSON-RPC, handshake timeout, process crash during shutdown) that are difficult to trigger deterministically. these are better validated by manual testing against misbehaving language servers than by unit tests.

---

## 9. roadmap

| phase | scope | status |
|-------|-------|--------|
| 0 | `kart_zoom` (level 0/1/2, file + directory), `kart_cochange` (kiste integration + graceful degradation) | **done** — export detection resolved (text scanning, semantic tokens dead end), per-tool runtimes (ADR-004) |
| 0.1 | `workspace/didChangeWatchedFiles` — file watcher to keep LS in sync after external edits | planned — deferred from phase 0, current limitation documented |
| 1 | latency spike for `kart_impact` — measure BFS over LSP on large codebases | make-or-break: determines live vs pre-computed architecture |
| 2 | `kart_impact` if spike is positive | call graph caching if live BFS is too slow |
| 3 | multi-language support (rust-analyzer, pyright adapters) | LSP client layer is language-agnostic but only TS adapter exists |

---

## 10. naming

**kart** is norwegian for "map." a map gives you orientation — where things are, how they connect, what's nearby — without loading the entire territory. you zoom in on what matters.

the toolkit: kart is the map, kiste is the chest of artifacts, varp is the warp threads holding the structure together.
