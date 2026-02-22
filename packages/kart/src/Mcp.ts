import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ManagedRuntime } from "effect";

import { CochangeDbLive } from "./Cochange.js";
import { tools } from "./Tools.js";

// ── Runtime ──

const DEFAULT_DB_PATH = ".varp/cochange.db";

const appLayer = CochangeDbLive(DEFAULT_DB_PATH);
const runtime = ManagedRuntime.make(appLayer);

// ── Server ──

function createServer(): McpServer {
  const server = new McpServer({ name: "kart", version: "0.1.0" });

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        try {
          const result = await runtime.runPromise(tool.handler(args as { path: string }));
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
