import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";

import { CochangeDb } from "./Cochange.js";

// ── Annotations ──

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

// ── Tool definitions ──

export const kart_cochange = {
  name: "kart_cochange",
  description:
    "Returns files that most frequently change alongside the queried file, ranked by co-change weight from git history. Requires a pre-built co-change database at .varp/cochange.db.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("File path relative to repo root"),
  },
  handler: (args: { path: string }) =>
    Effect.gen(function* () {
      const db = yield* CochangeDb;
      return yield* db.neighbors(args.path);
    }),
} as const;

export const tools = [kart_cochange] as const;
