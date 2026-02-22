import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Effect, Layer } from "effect";

import { LspClient } from "./Lsp.js";
import { FileNotFoundError, LspError, LspTimeoutError } from "./pure/Errors.js";
import { isExported } from "./pure/ExportDetection.js";
import { extractDocComment, extractSignature, symbolKindName } from "./pure/Signatures.js";
import type { DocumentSymbol } from "./pure/types.js";
import type { ZoomResult, ZoomSymbol } from "./pure/types.js";

export type { ZoomResult, ZoomSymbol } from "./pure/types.js";

// ── Constants ──

const MAX_LEVEL2_BYTES = 100 * 1024; // 100KB cap for level-2 full file content

// ── Symbol conversion ──

function toZoomSymbol(symbol: DocumentSymbol, lines: string[]): ZoomSymbol {
  const kind = symbolKindName(symbol.kind);
  const signature = extractSignature(symbol, lines);
  const doc = extractDocComment(symbol, lines);
  const exported = isExported(symbol, lines);

  const children =
    symbol.children && symbol.children.length > 0
      ? symbol.children.map((c) => toZoomSymbol(c, lines))
      : undefined;

  return { name: symbol.name, kind, signature, doc, exported, ...(children ? { children } : {}) };
}

// ── Service ──

export class SymbolIndex extends Context.Tag("kart/SymbolIndex")<
  SymbolIndex,
  {
    readonly zoom: (
      path: string,
      level: 0 | 1 | 2,
    ) => Effect.Effect<ZoomResult, LspError | LspTimeoutError | FileNotFoundError>;
  }
>() {}

// ── Layer ──

export const SymbolIndexLive = (config?: {
  rootDir?: string;
}): Layer.Layer<SymbolIndex, never, LspClient> =>
  Layer.effect(
    SymbolIndex,
    Effect.gen(function* () {
      const lsp = yield* LspClient;

      // Resolve workspace root for path boundary checks
      const rootDir = resolve(config?.rootDir ?? process.cwd());

      return SymbolIndex.of({
        zoom: (path, level) =>
          Effect.gen(function* () {
            const absPath = resolve(path);

            // Path traversal guard: reject paths outside workspace root
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }

            // Check existence
            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }

            // Directory zoom
            const stat = statSync(absPath);
            if (stat.isDirectory()) {
              return yield* zoomDirectory(lsp, absPath);
            }

            // Level 2: full file content (with size cap)
            if (level === 2) {
              const fileStat = statSync(absPath);
              const truncated = fileStat.size > MAX_LEVEL2_BYTES;
              const content = truncated
                ? readFileSync(absPath, "utf-8").slice(0, MAX_LEVEL2_BYTES)
                : readFileSync(absPath, "utf-8");
              return {
                path: absPath,
                level: 2 as const,
                symbols: [
                  {
                    name: absPath.split("/").pop() ?? absPath,
                    kind: "file",
                    signature: content,
                    doc: null,
                    exported: false,
                  },
                ],
                truncated,
              };
            }

            // Level 0 or 1: use LSP
            const uri = `file://${absPath}`;
            const symbols = yield* lsp.documentSymbol(uri);
            const fileContent = readFileSync(absPath, "utf-8");
            const lines = fileContent.split("\n");

            let zoomSymbols = symbols.map((s) => toZoomSymbol(s, lines));

            // Level 0: filter to exported only
            if (level === 0) {
              zoomSymbols = zoomSymbols.filter((s) => s.exported);
            }

            return {
              path: absPath,
              level,
              symbols: zoomSymbols,
              truncated: true,
            };
          }),
      });
    }),
  );

// ── Directory zoom helper ──

function zoomDirectory(
  lsp: Context.Tag.Service<typeof LspClient>,
  dirPath: string,
): Effect.Effect<ZoomResult, LspError | LspTimeoutError | FileNotFoundError> {
  return Effect.gen(function* () {
    const entries = readdirSync(dirPath);
    const tsFiles = entries
      .filter((e) => e.endsWith(".ts") || e.endsWith(".tsx"))
      .filter((e) => !e.endsWith(".test.ts") && !e.endsWith(".test.tsx"))
      .sort();

    const fileResults: ZoomResult[] = [];

    for (const file of tsFiles) {
      const filePath = resolve(dirPath, file);
      const uri = `file://${filePath}`;
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");

      const symbols = yield* lsp.documentSymbol(uri);
      const zoomSymbols = symbols.map((s) => toZoomSymbol(s, lines)).filter((s) => s.exported);

      // Omit files with no exports
      if (zoomSymbols.length === 0) continue;

      fileResults.push({
        path: filePath,
        level: 0,
        symbols: zoomSymbols,
        truncated: true,
      });
    }

    return {
      path: dirPath,
      level: 0 as const,
      symbols: [],
      truncated: true,
      files: fileResults,
    };
  });
}
