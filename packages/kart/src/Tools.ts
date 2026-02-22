import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";

import { CochangeDb } from "./Cochange.js";
import { SymbolIndex } from "./Symbols.js";

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

export const kart_zoom = {
  name: "kart_zoom",
  description:
    "Progressive disclosure of a file or directory's structure. Level 0 (default): exported symbols + signatures. Level 1: all symbols. Level 2: full file content.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("File or directory path"),
    level: z
      .number()
      .min(0)
      .max(2)
      .optional()
      .describe("Zoom level: 0 (exports), 1 (all symbols), 2 (full file). Default: 0"),
  },
  handler: (args: { path: string; level?: number }) =>
    Effect.gen(function* () {
      const idx = yield* SymbolIndex;
      return yield* idx.zoom(args.path, (args.level ?? 0) as 0 | 1 | 2);
    }),
} as const;

export const tools = [kart_cochange, kart_zoom] as const;
