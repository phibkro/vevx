import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Layer, ManagedRuntime } from "effect";

import { CochangeDbLive } from "./Cochange.js";
import { LspClientLive } from "./Lsp.js";
import { SymbolIndexLive } from "./Symbols.js";
import { tools } from "./Tools.js";

// ── Runtime ──

const DEFAULT_DB_PATH = ".varp/cochange.db";

const appLayer = Layer.mergeAll(
  CochangeDbLive(DEFAULT_DB_PATH),
  SymbolIndexLive.pipe(Layer.provide(LspClientLive({ rootDir: process.cwd() }))),
);
const runtime = ManagedRuntime.make(appLayer);

// ── Tool registration helper ──

function registerTool(
  server: McpServer,
  tool: (typeof tools)[number],
): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: tool.annotations,
    },
    async (args) => {
      try {
        const effect = tool.handler(args as never);
        const result = await runtime.runPromise(effect as Effect.Effect<unknown>);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (e) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: ${e instanceof Error ? e.message : String(e)}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}

// ── Server ──

function createServer(): McpServer {
  const server = new McpServer({ name: "kart", version: "0.1.0" });

  for (const tool of tools) {
    registerTool(server, tool);
  }

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
