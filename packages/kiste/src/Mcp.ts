import { resolve } from "node:path";

import { SqliteClient } from "@effect/sql-sqlite-bun";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Effect, Layer } from "effect";

import { ConfigLive } from "./Config.js";
import { DbFromConfig } from "./Db.js";
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
  const { repoDir, dbPath } = opts;
  const configLayer = ConfigLive(repoDir);

  // Explicit dbPath overrides config; otherwise read from .kiste.yaml
  const dbLayer = dbPath
    ? SqliteClient.layer({ filename: dbPath })
    : Layer.provideMerge(DbFromConfig(repoDir), configLayer);

  const layer = Layer.mergeAll(configLayer, dbLayer, GitLive);

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
