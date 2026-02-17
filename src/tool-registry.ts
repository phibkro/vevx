import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { z } from "zod";

export type ToolDef<T extends ZodRawShape = ZodRawShape> = {
  name: string;
  description: string;
  inputSchema: T;
  handler: (args: z.objectOutputType<T, z.ZodTypeAny>) => Promise<unknown>;
};

/**
 * Register tool definitions on an McpServer instance.
 * Wraps each handler with JSON serialization and error handling.
 */
export function registerTools(server: McpServer, tools: ToolDef[]): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (args) => {
        try {
          const result = await tool.handler(args);
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
}
