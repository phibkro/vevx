import { watch, type FSWatcher } from "node:fs";
import { extname, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, ManagedRuntime } from "effect";

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
import { makePhpAstPlugin, PhpLspPluginImpl } from "./PhpPlugin.js";
import { type AstPlugin, PluginUnavailableError } from "./Plugin.js";
import { makeRegistryFromPlugins, makeLspRuntimes } from "./PluginLayers.js";
import type { DepsResult, ImpactResult, ZoomResult } from "./pure/types.js";
import { makeRustAstPlugin, RustLspPluginImpl } from "./RustPlugin.js";
import { searchPattern, type SearchArgs } from "./Search.js";
import { formatZoomPlaintext } from "./Symbols.js";
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
import { TsAstPluginImpl, TsLspPluginImpl } from "./TsPlugin.js";

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

/** Strip range from location results (references, definition, type_definition, implementation). */
function compactLocations(
  result: Record<string, unknown>,
  rootDir: string,
): Record<string, unknown> {
  if (Array.isArray(result)) {
    return result.map((item) => compactLocationItem(item, rootDir)) as unknown as Record<
      string,
      unknown
    >;
  }
  // Results with a locations array (definition, type_definition, implementation)
  if ("locations" in result && Array.isArray(result.locations)) {
    return {
      ...result,
      locations: result.locations.map((loc: Record<string, unknown>) =>
        compactLocationItem(loc, rootDir),
      ),
    };
  }
  return result;
}

function compactLocationItem(
  item: Record<string, unknown>,
  rootDir: string,
): Record<string, unknown> {
  const { range: _range, ...rest } = item;
  if (typeof rest.uri === "string" && rest.uri.startsWith("file://")) {
    rest.path = rest.uri.slice(7).replace(rootDir + "/", "");
    delete rest.uri;
  }
  return rest;
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

// ── Plugin error helpers ──

/** Extract the PluginUnavailableError from a possibly-wrapped error, or return undefined. */
const getPluginUnavailableError = (e: unknown): PluginUnavailableError | undefined => {
  if (!e || typeof e !== "object") return undefined;
  // Direct check — TaggedError instances have _tag directly
  if ((e as Record<string, unknown>)._tag === "PluginUnavailableError")
    return e as PluginUnavailableError;
  // FiberFailure: Effect runtime wraps errors in a FiberFailure with the cause at a symbol key
  if (e instanceof Error) {
    const cause = (e as unknown as Record<symbol, unknown>)[FiberFailureCauseSymbol] as
      | { _tag?: string; error?: Record<string, unknown> }
      | undefined;
    if (cause?._tag === "Fail" && cause.error?.["_tag"] === "PluginUnavailableError") {
      return cause.error as unknown as PluginUnavailableError;
    }
  }
  return undefined;
};

function pluginUnavailableResponse(err: PluginUnavailableError) {
  const ext = extname(err.path);
  const result = {
    available: false,
    capability: err.capability,
    extension: ext,
    suggestion: "kart_search (ripgrep) is available for pattern search across all file types",
  };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>,
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
  const cochangeRuntime = ManagedRuntime.make(CochangeDbLive(dbPath));

  // Plugin registry — routes file extensions to the right plugin.
  // Tree-sitter AST plugins (Rust, PHP) are added lazily once WASM initializes.
  let registry = makeRegistryFromPlugins({
    ast: [TsAstPluginImpl],
    lsp: [TsLspPluginImpl, RustLspPluginImpl, PhpLspPluginImpl],
  });

  Promise.allSettled([makeRustAstPlugin(), makePhpAstPlugin()])
    .then((results) => {
      const ast: AstPlugin["Type"][] = [TsAstPluginImpl];
      if (results[0].status === "fulfilled") ast.push(results[0].value);
      if (results[1].status === "fulfilled") ast.push(results[1].value);
      registry = makeRegistryFromPlugins({
        ast,
        lsp: [TsLspPluginImpl, RustLspPluginImpl, PhpLspPluginImpl],
      });
    })
    .catch(() => {
      // tree-sitter init failed — some AST plugins won't be available
    });

  // LSP runtimes — lazily spawns per-language ManagedRuntimes.
  // Pass a getter so async registry updates (Rust AST plugin) are reflected.
  const lspRuntimes = makeLspRuntimes(() => registry, rootDir);

  // File watcher for incremental symbol cache invalidation
  const SOURCE_EXTS = new Set([".ts", ".tsx", ".rs", ".php"]);
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

  // ── LSP tool helper ──
  // Encapsulates the repeated pattern: runtimeFor lookup → Effect run → response/error shaping.
  // Tools with custom result formatting pass an optional transform function.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MCP SDK registerTool overloads are too narrow for generic wrappers
  function registerLspTool<TArgs extends { path: string }>(
    tool: {
      name: string;
      description: string;
      inputSchema: any;
      annotations: Record<string, unknown>;
      handler: (args: TArgs) => Effect.Effect<unknown, unknown, unknown>;
    },
    options?: { transform?: (result: unknown, rootDir: string) => unknown },
  ): void {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args: Record<string, unknown>) => {
        try {
          const typedArgs = args as TArgs;
          const runtime = await Effect.runPromise(lspRuntimes.runtimeFor(typedArgs.path));
          const raw = await runtime.runPromise(
            tool.handler(typedArgs) as Effect.Effect<unknown, never, never>,
          );
          const result = options?.transform ? options.transform(raw, rootDir) : raw;
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
            structuredContent: result as Record<string, unknown>,
          };
        } catch (e) {
          const unavailable = getPluginUnavailableError(e);
          if (unavailable) return pluginUnavailableResponse(unavailable);
          return {
            isError: true,
            content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          };
        }
      },
    );
  }

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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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

  // Register kart_zoom — plaintext output for levels 0/1, raw content for level 2
  server.registerTool(
    kart_zoom.name,
    {
      description: kart_zoom.description,
      inputSchema: kart_zoom.inputSchema,
      annotations: kart_zoom.annotations,
    },
    async (args: Record<string, unknown>) => {
      try {
        const typedArgs = args as { path: string; level?: number; resolveTypes?: boolean };
        const runtime = await Effect.runPromise(lspRuntimes.runtimeFor(typedArgs.path));
        const result = (await runtime.runPromise(
          kart_zoom.handler(typedArgs) as Effect.Effect<ZoomResult, never, never>,
        )) as ZoomResult;
        const text = formatZoomPlaintext(result, rootDir);
        return {
          content: [{ type: "text" as const, text }],
        };
      } catch (e) {
        const unavailable = getPluginUnavailableError(e);
        if (unavailable) return pluginUnavailableResponse(unavailable);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
        };
      }
    },
  );

  // Register kart_impact
  registerLspTool<{ path: string; symbol: string; depth?: number }>(kart_impact, {
    transform: (raw, dir) => compactImpact(raw as ImpactResult, dir),
  });

  // Register kart_references (LSP-backed) — compact: strip range, relativize uri
  registerLspTool<{ path: string; symbol: string; includeDeclaration?: boolean }>(kart_references, {
    transform: (raw, dir) => compactLocations(raw as Record<string, unknown>, dir),
  });

  // Register kart_definition (LSP-backed) — compact: strip range, relativize uri
  registerLspTool<{ path: string; symbol: string }>(kart_definition, {
    transform: (raw, dir) => compactLocations(raw as Record<string, unknown>, dir),
  });

  // Register kart_type_definition (LSP-backed) — compact: strip range, relativize uri
  registerLspTool<{ path: string; symbol: string }>(kart_type_definition, {
    transform: (raw, dir) => compactLocations(raw as Record<string, unknown>, dir),
  });

  // Register kart_implementation (LSP-backed) — compact: strip range, relativize uri
  registerLspTool<{ path: string; symbol: string }>(kart_implementation, {
    transform: (raw, dir) => compactLocations(raw as Record<string, unknown>, dir),
  });

  // Register kart_code_actions (LSP-backed)
  registerLspTool<{ path: string; symbol: string }>(kart_code_actions);

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
        const runtime = await Effect.runPromise(lspRuntimes.runtimeFor(typedArgs.path));
        const result = await runtime.runPromise(
          kart_expand_macro.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
  registerLspTool<{ path: string; startLine?: number; endLine?: number }>(kart_inlay_hints);

  // Register kart_rename (LSP-backed, write)
  registerLspTool<{ path: string; symbol: string; newName: string }>(kart_rename);

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
        const raw = await findSymbols({ ...(args as FindArgs), rootDir }, registry);
        const result = compactFind(raw);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
  registerLspTool<{ path: string; symbol: string; depth?: number }>(kart_deps, {
    transform: (raw, dir) => compactDeps(raw as DepsResult, dir),
  });

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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
        const astOpt = registry.astFor(typedArgs.file);
        if (astOpt._tag === "None") {
          return pluginUnavailableResponse(
            new PluginUnavailableError({ path: typedArgs.file, capability: "ast" }),
          );
        }
        const result = await editReplace(
          typedArgs.file,
          typedArgs.symbol,
          typedArgs.content,
          rootDir,
          typedArgs.format,
          astOpt.value,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
        const astOpt = registry.astFor(typedArgs.file);
        if (astOpt._tag === "None") {
          return pluginUnavailableResponse(
            new PluginUnavailableError({ path: typedArgs.file, capability: "ast" }),
          );
        }
        const result = await editInsertAfter(
          typedArgs.file,
          typedArgs.symbol,
          typedArgs.content,
          rootDir,
          typedArgs.format,
          astOpt.value,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
        const astOpt = registry.astFor(typedArgs.file);
        if (astOpt._tag === "None") {
          return pluginUnavailableResponse(
            new PluginUnavailableError({ path: typedArgs.file, capability: "ast" }),
          );
        }
        const result = await editInsertBefore(
          typedArgs.file,
          typedArgs.symbol,
          typedArgs.content,
          rootDir,
          typedArgs.format,
          astOpt.value,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
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
        const runtime = await Effect.runPromise(lspRuntimes.runtimeFor("workspace.ts"));
        const result = await runtime.runPromise(
          kart_workspace_symbol.handler(typedArgs) as Effect.Effect<unknown>,
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result as Record<string, unknown>,
        };
      } catch (e) {
        const unavailable = getPluginUnavailableError(e);
        if (unavailable) return pluginUnavailableResponse(unavailable);
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage(e)}` }],
          isError: true,
        };
      }
    },
  );

  // Register kart_restart (server-level — disposes and re-creates all LSP runtimes)
  server.registerTool(
    kart_restart.name,
    {
      description: kart_restart.description,
      inputSchema: kart_restart.inputSchema,
      annotations: kart_restart.annotations,
    },
    async () => {
      lspRuntimes.recreate();
      clearSymbolCache();
      symbolWatcher.close();
      symbolWatcher = startWatcher();
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ restarted: true, rootDir }) }],
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
