import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

import { Context, Effect, Layer } from "effect";

// ── Types ──

export type CochangeNeighbor = {
  readonly path: string;
  readonly score: number;
  readonly commits: number;
};

export type CochangeResult = {
  readonly path: string;
  readonly neighbors: readonly CochangeNeighbor[];
};

export type CochangeUnavailable = {
  readonly error: "co_change_data_unavailable";
  readonly message: string;
  readonly path: string;
};

// ── Service ──

export class CochangeDb extends Context.Tag("kart/CochangeDb")<
  CochangeDb,
  { readonly neighbors: (path: string) => Effect.Effect<CochangeResult | CochangeUnavailable> }
>() {}

// ── SQL ──

const NEIGHBORS_SQL = `
  select b.path, sum(e.weight) as coupling_score, count(*) as edge_count
  from co_change_edges e
  join artifacts a on e.artifact_a = a.id
  join artifacts b on e.artifact_b = b.id
  where a.path = ?
  group by b.path
  order by coupling_score desc
  limit 20
`;

// ── Layer ──

export const CochangeDbLive = (dbPath: string): Layer.Layer<CochangeDb> =>
  Layer.succeed(
    CochangeDb,
    CochangeDb.of({
      neighbors: (path) =>
        Effect.sync(() => {
          if (!existsSync(dbPath)) {
            return {
              error: "co_change_data_unavailable" as const,
              message:
                "co-change data not found. run `varp coupling --build` to generate it, then retry.",
              path: dbPath,
            };
          }

          const db = new Database(dbPath, { readonly: true });
          try {
            const rows = db
              .query<{ path: string; coupling_score: number; edge_count: number }, [string]>(
                NEIGHBORS_SQL,
              )
              .all(path);

            return {
              path,
              neighbors: rows.map((r) => ({
                path: r.path,
                score: r.coupling_score,
                commits: r.edge_count,
              })),
            };
          } finally {
            db.close();
          }
        }),
    }),
  );
