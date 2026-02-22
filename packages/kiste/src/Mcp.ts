import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { registerTools } from "./tool-registry.js";
import { tools } from "./Tools.js";

export function createServer(): McpServer {
  const server = new McpServer({ name: "kiste", version: "0.1.0" });
  registerTools(server, tools);
  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
