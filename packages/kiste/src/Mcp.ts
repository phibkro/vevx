import { resolve } from "node:path";

import { SqliteClient } from "@effect/sql-sqlite-bun";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Layer } from "effect";

import { ConfigLive } from "./Config.js";
import { GitLive } from "./Git.js";
import { registerTools } from "./tool-registry.js";
import { makeTools, type RunEffect } from "./Tools.js";

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export interface ServerOptions {
  readonly repoDir: string;
  readonly dbPath?: string;
}

export function createServer(opts: ServerOptions): McpServer {
  const { repoDir, dbPath = resolve(repoDir, ".kiste", "index.sqlite") } = opts;

  const layer = Layer.mergeAll(
    ConfigLive(repoDir),
    SqliteClient.layer({ filename: dbPath }),
    GitLive,
  );

  const run: RunEffect = (effect) => Effect.runPromise(Effect.provide(effect, layer));

  const server = new McpServer({ name: "kiste", version: "0.1.0" });
  registerTools(server, makeTools(run, repoDir));
  return server;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const repoDir = process.env.KISTE_REPO_DIR ?? process.cwd();
  const dbPath = process.env.KISTE_DB_PATH ?? undefined;

  const server = createServer({ repoDir, dbPath });
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
