import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";

import { CochangeDb } from "./Cochange.js";
import { findSymbols } from "./Find.js";
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

export const kart_impact = {
  name: "kart_impact",
  description:
    "Compute the blast radius of changing a symbol. Returns transitive callers via BFS over the call hierarchy. Use to understand what might break before modifying a function, method, or class.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("File path containing the symbol"),
    symbol: z.string().describe("Name of the symbol to analyze"),
    depth: z
      .number()
      .min(1)
      .max(5)
      .optional()
      .describe(
        "BFS depth limit (default: 3, max: 5). Higher depths may be slow on large codebases.",
      ),
  },
  handler: (args: { path: string; symbol: string; depth?: number }) =>
    Effect.gen(function* () {
      const idx = yield* SymbolIndex;
      return yield* idx.impact(args.path, args.symbol, args.depth);
    }),
} as const;

export const kart_find = {
  name: "kart_find",
  description:
    "Search for symbols across the workspace by name, kind, or export status. Uses oxc-parser for fast, LSP-free scanning of .ts/.tsx files.",
  annotations: READ_ONLY,
  inputSchema: {
    name: z.string().describe("Substring to match against symbol names. Empty string matches all."),
    kind: z
      .enum(["function", "class", "interface", "type", "enum", "const", "let", "var"])
      .optional()
      .describe("Filter by symbol kind"),
    exported: z.boolean().optional().describe("Filter by export status"),
    path: z
      .string()
      .optional()
      .describe("Restrict search to this subdirectory (relative to rootDir)"),
  },
  handler: (args: { name: string; kind?: string; exported?: boolean; path?: string }) =>
    Effect.promise(() => findSymbols(args)),
} as const;

export const tools = [kart_cochange, kart_zoom, kart_impact, kart_find] as const;
