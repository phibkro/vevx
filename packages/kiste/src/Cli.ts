import { resolve } from "node:path";

import { Command, Options } from "@effect/cli";
import { BunContext, BunRuntime } from "@effect/platform-bun";
import * as SqlClient from "@effect/sql/SqlClient";
import { Console, Effect, Layer } from "effect";

import { ConfigLive } from "./Config.js";
import { DbLive, initSchema } from "./Db.js";
import { GitLive } from "./Git.js";
import { incrementalIndex, rebuildIndex } from "./Indexer.js";

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

const dbLayer = (cwd: string) =>
  Layer.mergeAll(ConfigLive(cwd), DbLive(resolve(cwd, ".kiste", "index.sqlite")), GitLive);

// ---------------------------------------------------------------------------
// init — no DB needed
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG = `# .kiste.yaml — kiste configuration
# strip_prefixes:
#   - src
#   - lib
#   - components
#   - app
#   - pages
# stop_tags:
#   - index
#   - utils
#   - helpers
#   - types
# snapshot_frequency: 500
# exclude:
#   - "node_modules/**"
#   - "dist/**"
#   - "*.lock"
# db_path: .kiste/index.sqlite
`;

const initCmd = Command.make("init", {}, () =>
  Effect.gen(function* () {
    const cwd = process.cwd();
    const configPath = resolve(cwd, ".kiste.yaml");
    const kisteDir = resolve(cwd, ".kiste");

    yield* Effect.tryPromise({
      try: async () => {
        const { mkdirSync, existsSync } = await import("node:fs");
        if (!existsSync(kisteDir)) mkdirSync(kisteDir, { recursive: true });
      },
      catch: (e) => new Error(`Failed to create .kiste/: ${String(e)}`),
    });

    yield* Effect.tryPromise({
      try: async () => {
        const file = Bun.file(configPath);
        if (await file.exists()) return false;
        await Bun.write(configPath, DEFAULT_CONFIG);
        return true;
      },
      catch: (e) => new Error(`Failed to write .kiste.yaml: ${String(e)}`),
    }).pipe(
      Effect.flatMap((created) =>
        created
          ? Console.log("Created .kiste.yaml and .kiste/")
          : Console.log(".kiste.yaml already exists. Created .kiste/ directory."),
      ),
    );
  }),
);

// ---------------------------------------------------------------------------
// index — needs DB + Git + Config
// ---------------------------------------------------------------------------

const rebuildOpt = Options.boolean("rebuild").pipe(
  Options.withDescription("Full rebuild instead of incremental index"),
);

const indexCmd = Command.make("index", { rebuild: rebuildOpt }, ({ rebuild }) =>
  Effect.gen(function* () {
    const cwd = process.cwd();
    yield* initSchema;
    const result = rebuild ? yield* rebuildIndex(cwd) : yield* incrementalIndex(cwd);
    yield* Console.log(
      `Indexed ${result.commits_indexed} commits, ${result.artifacts_indexed} artifacts, ${result.artifacts_deleted} deleted`,
    );
  }).pipe(Effect.provide(dbLayer(process.cwd()))),
);

// ---------------------------------------------------------------------------
// status — needs DB
// ---------------------------------------------------------------------------

const statusCmd = Command.make("status", {}, () =>
  Effect.gen(function* () {
    yield* initSchema;
    const sql = yield* SqlClient.SqlClient;

    const commits = yield* sql<{ count: number }>`SELECT COUNT(*) as count FROM commits`;
    const alive = yield* sql<{
      count: number;
    }>`SELECT COUNT(*) as count FROM artifacts WHERE alive = 1`;
    const deleted = yield* sql<{
      count: number;
    }>`SELECT COUNT(*) as count FROM artifacts WHERE alive = 0`;
    const tags = yield* sql<{
      count: number;
    }>`SELECT COUNT(DISTINCT tag) as count FROM artifact_tags`;
    const meta = yield* sql<{
      value: string;
    }>`SELECT value FROM meta WHERE key = 'last_indexed_sha'`;

    yield* Console.log(`Commits:           ${commits[0]?.count ?? 0}`);
    yield* Console.log(`Artifacts (alive): ${alive[0]?.count ?? 0}`);
    yield* Console.log(`Artifacts (dead):  ${deleted[0]?.count ?? 0}`);
    yield* Console.log(`Tags (distinct):   ${tags[0]?.count ?? 0}`);
    yield* Console.log(`Last indexed SHA:  ${meta[0]?.value ?? "(none)"}`);
  }).pipe(Effect.provide(dbLayer(process.cwd()))),
);

// ---------------------------------------------------------------------------
// query — needs DB
// ---------------------------------------------------------------------------

const tagsOpt = Options.text("tags").pipe(
  Options.withDescription("Comma-separated tags to match (AND logic)"),
);

const queryCmd = Command.make("query", { tags: tagsOpt }, ({ tags }) =>
  Effect.gen(function* () {
    yield* initSchema;
    const sql = yield* SqlClient.SqlClient;
    const tagList = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (tagList.length === 0) {
      yield* Console.log("No tags specified");
      return;
    }

    const placeholders = tagList.map(() => "?").join(", ");
    const rows = yield* sql.unsafe<{ path: string; tags: string }>(
      `SELECT a.path, GROUP_CONCAT(at2.tag) as tags
       FROM artifacts a
       JOIN artifact_tags at1 ON a.id = at1.artifact_id
       LEFT JOIN artifact_tags at2 ON a.id = at2.artifact_id
       WHERE a.alive = 1 AND at1.tag IN (${placeholders})
       GROUP BY a.id
       HAVING COUNT(DISTINCT at1.tag) = ?
       ORDER BY a.path`,
      [...tagList, tagList.length],
    );

    if (rows.length === 0) {
      yield* Console.log(`No artifacts match tags: ${tagList.join(", ")}`);
      return;
    }

    for (const row of rows) {
      yield* Console.log(`${row.path}  [${row.tags}]`);
    }
  }).pipe(Effect.provide(dbLayer(process.cwd()))),
);

// ---------------------------------------------------------------------------
// root command + run
// ---------------------------------------------------------------------------

const rootCmd = Command.make("kiste").pipe(
  Command.withSubcommands([initCmd, indexCmd, statusCmd, queryCmd]),
);

const cli = rootCmd.pipe(Command.run({ name: "kiste", version: "0.1.0" }));

cli(process.argv).pipe(Effect.provide(BunContext.layer), BunRuntime.runMain);
