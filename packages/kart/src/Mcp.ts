import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Layer, ManagedRuntime } from "effect";

import { CochangeDbLive } from "./Cochange.js";
import { LspClientLive } from "./Lsp.js";
import { SymbolIndexLive } from "./Symbols.js";
import { kart_cochange, kart_zoom } from "./Tools.js";

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
  const zoomRuntime = ManagedRuntime.make(
    SymbolIndexLive({ rootDir }).pipe(Layer.provide(LspClientLive({ rootDir }))),
  );

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
        };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` },
          ],
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
        };
      } catch (e) {
        return {
          content: [
            { type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` },
          ],
          isError: true,
        };
      }
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

export { createServer };
