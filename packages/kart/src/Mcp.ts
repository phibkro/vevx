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
import { findSymbols, type FindArgs } from "./Find.js";
import {
  getImporters,
  getImports,
  getUnusedExports,
  type ImportersArgs,
  type ImportsArgs,
} from "./Imports.js";
import { listDirectory, type ListArgs } from "./List.js";
import { LspClientLive } from "./Lsp.js";
import { searchPattern, type SearchArgs } from "./Search.js";
import { SymbolIndexLive } from "./Symbols.js";
import {
  kart_cochange,
  kart_deps,
  kart_diagnostics,
  kart_find,
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
  kart_unused_exports,
  kart_zoom,
} from "./Tools.js";

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

  const makeZoomRuntime = () =>
    ManagedRuntime.make(
      SymbolIndexLive({ rootDir }).pipe(Layer.provide(LspClientLive({ rootDir }))),
    );
  let zoomRuntime = makeZoomRuntime();

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
        const result = await zoomRuntime.runPromise(
          kart_zoom.handler(args as { path: string; level?: number }) as Effect.Effect<unknown>,
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
        const result = await zoomRuntime.runPromise(
          kart_impact.handler(
            args as { path: string; symbol: string; depth?: number },
          ) as Effect.Effect<unknown>,
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
        const result = await zoomRuntime.runPromise(
          kart_references.handler(
            args as { path: string; symbol: string; includeDeclaration?: boolean },
          ) as Effect.Effect<unknown>,
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
        const result = await zoomRuntime.runPromise(
          kart_rename.handler(
            args as { path: string; symbol: string; newName: string },
          ) as Effect.Effect<unknown>,
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
        const result = await findSymbols({ ...(args as FindArgs), rootDir });
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
        const result = await zoomRuntime.runPromise(
          kart_deps.handler(
            args as { path: string; symbol: string; depth?: number },
          ) as Effect.Effect<unknown>,
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
        const result = await editReplace(
          (args as { file: string }).file,
          (args as { symbol: string }).symbol,
          (args as { content: string }).content,
          rootDir,
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
        const result = await editInsertAfter(
          (args as { file: string }).file,
          (args as { symbol: string }).symbol,
          (args as { content: string }).content,
          rootDir,
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
        const result = await editInsertBefore(
          (args as { file: string }).file,
          (args as { symbol: string }).symbol,
          (args as { content: string }).content,
          rootDir,
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
      zoomRuntime = makeZoomRuntime();
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
