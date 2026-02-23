import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { Effect } from "effect";
import { z } from "zod";

import { CochangeDb } from "./Cochange.js";
import { runDiagnostics } from "./Diagnostics.js";
import { editInsertAfter, editInsertBefore, editReplace } from "./Editor.js";
import { findSymbols } from "./Find.js";
import { listDirectory } from "./List.js";
import { searchPattern } from "./Search.js";
import { SymbolIndex } from "./Symbols.js";

// ── Annotations ──

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const READ_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
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

export const kart_deps = {
  name: "kart_deps",
  description:
    "List the dependencies of a symbol. Returns transitive callees via BFS over the call hierarchy. Use to understand what a function, method, or class relies on.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("File path containing the symbol"),
    symbol: z.string().describe("Name of the symbol to analyze"),
    depth: z.number().min(1).max(5).optional().describe("BFS depth limit (default: 3, max: 5)."),
  },
  handler: (args: { path: string; symbol: string; depth?: number }) =>
    Effect.gen(function* () {
      const idx = yield* SymbolIndex;
      return yield* idx.deps(args.path, args.symbol, args.depth);
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

export const kart_search = {
  name: "kart_search",
  description:
    "Search for text patterns across the workspace using ripgrep. Gitignore-aware by default. Returns matching lines with file paths and line numbers.",
  annotations: READ_ONLY,
  inputSchema: {
    pattern: z.string().describe("Regex pattern to search for"),
    glob: z.string().optional().describe('File filter glob, e.g. "*.ts"'),
    paths: z
      .array(z.string())
      .optional()
      .describe("Restrict search to specific paths (relative to rootDir)"),
  },
  handler: (args: { pattern: string; glob?: string; paths?: string[] }) =>
    Effect.promise(() => searchPattern(args)),
} as const;

export const kart_list = {
  name: "kart_list",
  description:
    "List files and directories. Excludes node_modules, .git, dist, build, .varp. Supports recursive listing and glob filtering.",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("Directory path to list (relative to workspace root)"),
    recursive: z.boolean().optional().describe("List files recursively (default: false)"),
    glob: z.string().optional().describe('Glob pattern to filter entries, e.g. "*.ts"'),
  },
  handler: (args: { path: string; recursive?: boolean; glob?: string }) =>
    Effect.sync(() => listDirectory(args)),
} as const;

export const kart_rename = {
  name: "kart_rename",
  description:
    "Rename a symbol across the workspace. Applies reference-aware rename via LSP, modifying all files that reference the symbol. Returns which files were modified.",
  annotations: READ_WRITE,
  inputSchema: {
    path: z.string().describe("File path containing the symbol to rename"),
    symbol: z.string().describe("Current name of the symbol"),
    newName: z.string().describe("New name for the symbol"),
  },
  handler: (args: { path: string; symbol: string; newName: string }) =>
    Effect.gen(function* () {
      const idx = yield* SymbolIndex;
      return yield* idx.rename(args.path, args.symbol, args.newName);
    }),
} as const;

export const kart_references = {
  name: "kart_references",
  description:
    "Find all references to a symbol across the workspace. Returns file paths and positions where the symbol is used. Requires LSP (typescript-language-server).",
  annotations: READ_ONLY,
  inputSchema: {
    path: z.string().describe("File path containing the symbol"),
    symbol: z.string().describe("Name of the symbol to find references for"),
    includeDeclaration: z
      .boolean()
      .optional()
      .describe("Include the declaration site in results (default: true)"),
  },
  handler: (args: { path: string; symbol: string; includeDeclaration?: boolean }) =>
    Effect.gen(function* () {
      const idx = yield* SymbolIndex;
      return yield* idx.references(args.path, args.symbol, args.includeDeclaration);
    }),
} as const;

export const kart_diagnostics = {
  name: "kart_diagnostics",
  description:
    "Run oxlint with type-aware rules on specified files or directories. Returns structured lint violations and type errors. Gracefully degrades when oxlint is unavailable.",
  annotations: READ_ONLY,
  inputSchema: {
    paths: z
      .array(z.string())
      .describe("File or directory paths to lint (relative to workspace root)"),
  },
  handler: (args: { paths: string[] }) => Effect.promise(() => runDiagnostics(args)),
} as const;

export const kart_replace = {
  name: "kart_replace",
  description:
    "Replace a symbol's full definition in a file. Validates syntax before writing. Returns inline diagnostics from oxlint.",
  annotations: READ_WRITE,
  inputSchema: {
    file: z.string().describe("Absolute path to the file"),
    symbol: z.string().describe("Name of the symbol to replace"),
    content: z.string().describe("New content to replace the symbol with (must be valid syntax)"),
  },
  handler: (args: { file: string; symbol: string; content: string }) =>
    Effect.promise(() => editReplace(args.file, args.symbol, args.content)),
} as const;

export const kart_insert_after = {
  name: "kart_insert_after",
  description:
    "Insert content after a symbol's definition. Use to add new functions, types, or exports after an existing symbol.",
  annotations: READ_WRITE,
  inputSchema: {
    file: z.string().describe("Absolute path to the file"),
    symbol: z.string().describe("Name of the symbol to insert after"),
    content: z.string().describe("Content to insert after the symbol"),
  },
  handler: (args: { file: string; symbol: string; content: string }) =>
    Effect.promise(() => editInsertAfter(args.file, args.symbol, args.content)),
} as const;

export const kart_insert_before = {
  name: "kart_insert_before",
  description:
    "Insert content before a symbol's definition. Use to add imports, comments, or declarations before an existing symbol.",
  annotations: READ_WRITE,
  inputSchema: {
    file: z.string().describe("Absolute path to the file"),
    symbol: z.string().describe("Name of the symbol to insert before"),
    content: z.string().describe("Content to insert before the symbol"),
  },
  handler: (args: { file: string; symbol: string; content: string }) =>
    Effect.promise(() => editInsertBefore(args.file, args.symbol, args.content)),
} as const;

export const tools = [
  kart_cochange,
  kart_zoom,
  kart_impact,
  kart_deps,
  kart_find,
  kart_search,
  kart_list,
  kart_rename,
  kart_references,
  kart_diagnostics,
  kart_replace,
  kart_insert_after,
  kart_insert_before,
] as const;
