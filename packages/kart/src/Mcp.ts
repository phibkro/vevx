import { watch, type FSWatcher } from "node:fs";
import { resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Layer, ManagedRuntime } from "effect";

/** Symbol used by Effect to store the Cause inside FiberFailure. */
const FiberFailureCauseSymbol = Symbol.for("effect/Runtime/FiberFailure/Cause");

/** Extract a useful error message from Effect errors (FiberFailure wrapping Data.TaggedError). */
function errorMessage(e: unknown): string {
  if (!e || typeof e !== "object") return String(e);

  // FiberFailure: extract the cause via symbol
  const obj = e as Record<symbol, unknown>;
  const cause = obj[FiberFailureCauseSymbol] as
    | { _tag?: string; error?: Record<string, unknown> }
    | undefined;
  if (cause && cause._tag === "Fail" && cause.error) {
    const failure = cause.error;
    const tag = failure._tag as string | undefined;
    if (tag) {
      if ("path" in failure && typeof failure.path === "string") return `${tag}: ${failure.path}`;
      if (
        "message" in failure &&
        typeof failure.message === "string" &&
        failure.message !== "An error has occurred"
      )
        return `${tag}: ${failure.message}`;
      return tag;
    }
  }

  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

import { CochangeDbLive } from "./Cochange.js";
import { runDiagnostics, type DiagnosticsArgs } from "./Diagnostics.js";
import { editInsertAfter, editInsertBefore, editReplace } from "./Editor.js";
import { clearSymbolCache, findSymbols, invalidateCacheEntry, type FindArgs } from "./Find.js";
import {
  getImporters,
  getImports,
  getUnusedExports,
  type ImportersArgs,
  type ImportsArgs,
} from "./Imports.js";
import { listDirectory, type ListArgs } from "./List.js";
import { LspClientLive, rustLanguageServer } from "./Lsp.js";
import { initRustParser } from "./pure/RustSymbols.js";
import type { DepsResult, ImpactResult } from "./pure/types.js";
import { searchPattern, type SearchArgs } from "./Search.js";
import { SymbolIndexLive } from "./Symbols.js";
import {
  kart_code_actions,
  kart_cochange,
  kart_definition,
  kart_deps,
  kart_diagnostics,
  kart_expand_macro,
  kart_find,
  kart_implementation,
  kart_inlay_hints,
  kart_references,
  kart_rename,
  kart_impact,
  kart_importers,
  kart_imports,
  kart_insert_after,
  kart_insert_before,
  kart_list,
  kart_replace,
  kart_search,
  kart_restart,
  kart_type_definition,
  kart_unused_exports,
  kart_workspace_symbol,
  kart_zoom,
} from "./Tools.js";

// ── Response compaction ──

/** Strip debug metadata from find results — agents don't need timing/cache stats. */
function compactFind(result: {
  symbols: unknown[];
  fileCount: number;
  cachedFiles: number;
  durationMs: number;
}) {
  return { symbols: result.symbols, fileCount: result.fileCount };
}

/** Strip range and absolutize uri→path in impact/deps tree nodes for smaller responses. */
function compactImpactNode(
  node: {
    name: string;
    kind: number;
    uri: string;
    range: unknown;
    fanOut: number;
    callers?: unknown[];
  },
  rootDir: string,
): Record<string, unknown> {
  const path = node.uri.startsWith("file://")
    ? node.uri.slice(7).replace(rootDir + "/", "")
    : node.uri;
  return {
    name: node.name,
    kind: node.kind,
    path,
    fanOut: node.fanOut,
    ...(node.callers
      ? { callers: (node.callers as (typeof node)[]).map((c) => compactImpactNode(c, rootDir)) }
      : {}),
  };
}

function compactDepsNode(
  node: {
    name: string;
    kind: number;
    uri: string;
    range: unknown;
    fanOut: number;
    callees?: unknown[];
  },
  rootDir: string,
): Record<string, unknown> {
  const path = node.uri.startsWith("file://")
    ? node.uri.slice(7).replace(rootDir + "/", "")
    : node.uri;
  return {
    name: node.name,
    kind: node.kind,
    path,
    fanOut: node.fanOut,
    ...(node.callees
      ? { callees: (node.callees as (typeof node)[]).map((c) => compactDepsNode(c, rootDir)) }
      : {}),
  };
}

function compactImpact(result: ImpactResult, rootDir: string) {
  return {
    symbol: result.symbol,
    path: result.path,
    depth: result.depth,
    maxDepth: result.maxDepth,
    totalNodes: result.totalNodes,
    highFanOut: result.highFanOut,
    root: compactImpactNode(
      result.root as unknown as Parameters<typeof compactImpactNode>[0],
      rootDir,
    ),
  };
}

function compactDeps(result: DepsResult, rootDir: string) {
  return {
    symbol: result.symbol,
    path: result.path,
    depth: result.depth,
    maxDepth: result.maxDepth,
    totalNodes: result.totalNodes,
    highFanOut: result.highFanOut,
    root: compactDepsNode(result.root as unknown as Parameters<typeof compactDepsNode>[0], rootDir),
  };
}

// ── Config ──

export type ServerConfig = {
  /** Path to the co-change SQLite database. Default: `.varp/cochange.db` */
  readonly dbPath?: string;
  /** Workspace root for LSP. Default: `process.cwd()` */
  readonly rootDir?: string;
};

// ── Server ──

function createServer(config: ServerConfig = {}): McpServer {
  const dbPath = config.dbPath ?? ".varp/cochange.db";
  const rootDir = config.rootDir ?? process.cwd();

  // Separate runtimes: each tool only initializes what it needs.
  // This avoids LSP startup failure blocking the cochange tool.
  const cochangeRuntime = ManagedRuntime.make(CochangeDbLive(dbPath));

  // TS zoom runtime (always created)
  const makeZoomRuntime = () =>
    ManagedRuntime.make(
      SymbolIndexLive({ rootDir }).pipe(Layer.provide(LspClientLive({ rootDir }))),
    );
  let zoomRuntime = makeZoomRuntime();

  // Rust zoom runtime (lazy — only created on first .rs LSP tool call)
  const makeRustRuntime = () =>
    ManagedRuntime.make(
      SymbolIndexLive({ rootDir }).pipe(
        Layer.provide(LspClientLive({ rootDir, languageServer: rustLanguageServer })),
      ),
    );
  let rustRuntime: ReturnType<typeof makeRustRuntime> | null = null;

  /** Pick the right LSP runtime based on file extension. */
  const runtimeFor = (path: string) => {
    if (path.endsWith(".rs")) {
      rustRuntime ??= makeRustRuntime();
      return rustRuntime;
    }
    return zoomRuntime;
  };

  // Initialize Rust parser eagerly for kart_find (tree-sitter, not LSP)
  initRustParser().catch(() => {
    // tree-sitter init failed — .rs files won't work in kart_find
    // but TS tools still function normally
  });

  // File watcher for incremental symbol cache invalidation
  const SOURCE_EXTS = new Set([".ts", ".tsx", ".rs"]);
  const startWatcher = (): FSWatcher => {
    const w = watch(rootDir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      const dot = filename.lastIndexOf(".");
      if (dot === -1 || !SOURCE_EXTS.has(filename.slice(dot))) return;
      invalidateCacheEntry(resolve(rootDir, filename));
    });
    w.on("error", () => {});
    return w;
  };
  let symbolWatcher = startWatcher();

  const server = new McpServer({ name: "kart", version: "0.1.0" });

  // Register kart_cochange
  server.registerTool(
    kart_cochange.name,
    {
      description: kart_cochange.description,
      inputSchema: kart_cochange.inputSchema,
      annotations: kart_cochange.annotations,
    },
    async (args) => {
      try {
        const result = await cochangeRuntime.runPromise(
          kart_cochange.handler(args as { path: string }),
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_zoom
  server.registerTool(
    kart_zoom.name,
    {
      description: kart_zoom.description,
      inputSchema: kart_zoom.inputSchema,
      annotations: kart_zoom.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; level?: number; resolveTypes?: boolean };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_zoom.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_impact
  server.registerTool(
    kart_impact.name,
    {
      description: kart_impact.description,
      inputSchema: kart_impact.inputSchema,
      annotations: kart_impact.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string; depth?: number };
        const raw = await runtimeFor(typedArgs.path).runPromise(
          kart_impact.handler(typedArgs) as Effect.Effect<unknown>,
        );
        const result = compactImpact(raw as ImpactResult, rootDir);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_references (LSP-backed)
  server.registerTool(
    kart_references.name,
    {
      description: kart_references.description,
      inputSchema: kart_references.inputSchema,
      annotations: kart_references.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string; includeDeclaration?: boolean };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_references.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_definition (LSP-backed)
  server.registerTool(
    kart_definition.name,
    {
      description: kart_definition.description,
      inputSchema: kart_definition.inputSchema,
      annotations: kart_definition.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_definition.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_type_definition (LSP-backed)
  server.registerTool(
    kart_type_definition.name,
    {
      description: kart_type_definition.description,
      inputSchema: kart_type_definition.inputSchema,
      annotations: kart_type_definition.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_type_definition.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_implementation (LSP-backed)
  server.registerTool(
    kart_implementation.name,
    {
      description: kart_implementation.description,
      inputSchema: kart_implementation.inputSchema,
      annotations: kart_implementation.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_implementation.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_code_actions (LSP-backed)
  server.registerTool(
    kart_code_actions.name,
    {
      description: kart_code_actions.description,
      inputSchema: kart_code_actions.inputSchema,
      annotations: kart_code_actions.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_code_actions.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_expand_macro (Rust only, LSP-backed)
  server.registerTool(
    kart_expand_macro.name,
    {
      description: kart_expand_macro.description,
      inputSchema: kart_expand_macro.inputSchema,
      annotations: kart_expand_macro.annotations,
    },
    async (args) => {
      const typedArgs = args as { path: string; symbol: string };
      if (!typedArgs.path.endsWith(".rs")) {
        return {
          content: [
            {
              type: "text" as const,
              text: "Error: kart_expand_macro only works with Rust files (.rs)",
            },
          ],
          isError: true,
        };
      }
      try {
        rustRuntime ??= makeRustRuntime();
        const result = await rustRuntime.runPromise(
          kart_expand_macro.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_inlay_hints (LSP-backed)
  server.registerTool(
    kart_inlay_hints.name,
    {
      description: kart_inlay_hints.description,
      inputSchema: kart_inlay_hints.inputSchema,
      annotations: kart_inlay_hints.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; startLine?: number; endLine?: number };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_inlay_hints.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_rename (LSP-backed, write)
  server.registerTool(
    kart_rename.name,
    {
      description: kart_rename.description,
      inputSchema: kart_rename.inputSchema,
      annotations: kart_rename.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string; newName: string };
        const result = await runtimeFor(typedArgs.path).runPromise(
          kart_rename.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_find (stateless — no Effect runtime needed)
  server.registerTool(
    kart_find.name,
    {
      description: kart_find.description,
      inputSchema: kart_find.inputSchema,
      annotations: kart_find.annotations,
    },
    async (args) => {
      try {
        const raw = await findSymbols({ ...(args as FindArgs), rootDir });
        const result = compactFind(raw);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_search (stateless — no Effect runtime needed)
  server.registerTool(
    kart_search.name,
    {
      description: kart_search.description,
      inputSchema: kart_search.inputSchema,
      annotations: kart_search.annotations,
    },
    async (args) => {
      try {
        const result = await searchPattern({ ...(args as SearchArgs), rootDir });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_deps
  server.registerTool(
    kart_deps.name,
    {
      description: kart_deps.description,
      inputSchema: kart_deps.inputSchema,
      annotations: kart_deps.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { path: string; symbol: string; depth?: number };
        const raw = await runtimeFor(typedArgs.path).runPromise(
          kart_deps.handler(typedArgs) as Effect.Effect<unknown>,
        );
        const result = compactDeps(raw as DepsResult, rootDir);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_list (stateless — no Effect runtime needed)
  server.registerTool(
    kart_list.name,
    {
      description: kart_list.description,
      inputSchema: kart_list.inputSchema,
      annotations: kart_list.annotations,
    },
    async (args) => {
      try {
        const result = listDirectory({ ...(args as ListArgs), rootDir });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_diagnostics (stateless — no Effect runtime needed)
  server.registerTool(
    kart_diagnostics.name,
    {
      description: kart_diagnostics.description,
      inputSchema: kart_diagnostics.inputSchema,
      annotations: kart_diagnostics.annotations,
    },
    async (args) => {
      try {
        const result = await runDiagnostics({ ...(args as DiagnosticsArgs), rootDir });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_replace (stateless — no Effect runtime needed)
  server.registerTool(
    kart_replace.name,
    {
      description: kart_replace.description,
      inputSchema: kart_replace.inputSchema,
      annotations: kart_replace.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as {
          file: string;
          symbol: string;
          content: string;
          format?: boolean;
        };
        const result = await editReplace(
          typedArgs.file,
          typedArgs.symbol,
          typedArgs.content,
          rootDir,
          typedArgs.format,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_insert_after (stateless — no Effect runtime needed)
  server.registerTool(
    kart_insert_after.name,
    {
      description: kart_insert_after.description,
      inputSchema: kart_insert_after.inputSchema,
      annotations: kart_insert_after.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as {
          file: string;
          symbol: string;
          content: string;
          format?: boolean;
        };
        const result = await editInsertAfter(
          typedArgs.file,
          typedArgs.symbol,
          typedArgs.content,
          rootDir,
          typedArgs.format,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_insert_before (stateless — no Effect runtime needed)
  server.registerTool(
    kart_insert_before.name,
    {
      description: kart_insert_before.description,
      inputSchema: kart_insert_before.inputSchema,
      annotations: kart_insert_before.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as {
          file: string;
          symbol: string;
          content: string;
          format?: boolean;
        };
        const result = await editInsertBefore(
          typedArgs.file,
          typedArgs.symbol,
          typedArgs.content,
          rootDir,
          typedArgs.format,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_imports (stateless — no Effect runtime needed)
  server.registerTool(
    kart_imports.name,
    {
      description: kart_imports.description,
      inputSchema: kart_imports.inputSchema,
      annotations: kart_imports.annotations,
    },
    async (args) => {
      try {
        const result = await getImports((args as ImportsArgs).path, rootDir);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_importers (stateless — no Effect runtime needed)
  server.registerTool(
    kart_importers.name,
    {
      description: kart_importers.description,
      inputSchema: kart_importers.inputSchema,
      annotations: kart_importers.annotations,
    },
    async (args) => {
      try {
        const result = await getImporters((args as ImportersArgs).path, rootDir);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_unused_exports (stateless — no Effect runtime needed)
  server.registerTool(
    kart_unused_exports.name,
    {
      description: kart_unused_exports.description,
      inputSchema: kart_unused_exports.inputSchema,
      annotations: kart_unused_exports.annotations,
    },
    async () => {
      try {
        const result = await getUnusedExports(rootDir);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as unknown as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_workspace_symbol (LSP-backed, uses TS runtime)
  server.registerTool(
    kart_workspace_symbol.name,
    {
      description: kart_workspace_symbol.description,
      inputSchema: kart_workspace_symbol.inputSchema,
      annotations: kart_workspace_symbol.annotations,
    },
    async (args) => {
      try {
        const typedArgs = args as { query: string };
        const result = await zoomRuntime.runPromise(
          kart_workspace_symbol.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_restart (server-level — disposes and re-creates zoomRuntime)
  server.registerTool(
    kart_restart.name,
    {
      description: kart_restart.description,
      inputSchema: kart_restart.inputSchema,
      annotations: kart_restart.annotations,
    },
    async () => {
      try {
        await zoomRuntime.dispose();
      } catch {
        // Ignore dispose errors — the LSP may already be dead
      }
      if (rustRuntime) {
        try {
          await rustRuntime.dispose();
        } catch {
          // Ignore dispose errors
        }
        rustRuntime = null;
      }
      zoomRuntime = makeZoomRuntime();
      clearSymbolCache();
      symbolWatcher.close();
      symbolWatcher = startWatcher();
      return {
        content: [
          { type: "text" as const, text: JSON.stringify({ restarted: true, rootDir }, null, 2) },
        ],
        structuredContent: { restarted: true, rootDir } as Record<string, unknown>,
      };
    },
  );

  return server;
}

// ── Main ──

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});

export { createServer, errorMessage };
