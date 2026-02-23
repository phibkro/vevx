import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Effect, Layer } from "effect";

import { LspClient } from "./Lsp.js";
import { FileNotFoundError, LspError, LspTimeoutError } from "./pure/Errors.js";
import { isExported } from "./pure/ExportDetection.js";
import { extractDocComment, extractSignature, symbolKindName } from "./pure/Signatures.js";
import type {
  CallHierarchyItem,
  DepsNode,
  DepsResult,
  DocumentSymbol,
  ImpactNode,
  ImpactResult,
  ReferencesResult,
  RenameResult,
  TextEdit,
} from "./pure/types.js";
import type { ZoomResult, ZoomSymbol } from "./pure/types.js";

export type {
  DepsResult,
  ImpactResult,
  ReferencesResult,
  RenameResult,
  ZoomResult,
  ZoomSymbol,
} from "./pure/types.js";

// ── Constants ──

const MAX_LEVEL2_BYTES = 100 * 1024; // 100KB cap for level-2 full file content
const MAX_IMPACT_DEPTH = 5; // Hard cap on BFS depth to prevent full-graph traversal
const HIGH_FAN_OUT_THRESHOLD = 10; // Warn agents when fan-out exceeds this

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

// ── Symbol lookup ──

function findSymbolByName(
  symbols: readonly DocumentSymbol[],
  name: string,
): DocumentSymbol | undefined {
  for (const s of symbols) {
    if (s.name === name) return s;
    if (s.children) {
      const found = findSymbolByName(s.children, name);
      if (found) return found;
    }
  }
  return undefined;
}

// ── Service ──

export class SymbolIndex extends Context.Tag("kart/SymbolIndex")<
  SymbolIndex,
  {
    readonly zoom: (
      path: string,
      level: 0 | 1 | 2,
    ) => Effect.Effect<ZoomResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly impact: (
      path: string,
      symbolName: string,
      maxDepth?: number,
    ) => Effect.Effect<ImpactResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly deps: (
      path: string,
      symbolName: string,
      maxDepth?: number,
    ) => Effect.Effect<DepsResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly references: (
      path: string,
      symbolName: string,
      includeDeclaration?: boolean,
    ) => Effect.Effect<ReferencesResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly rename: (
      path: string,
      symbolName: string,
      newName: string,
    ) => Effect.Effect<RenameResult, LspError | LspTimeoutError | FileNotFoundError>;
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

        impact: (path, symbolName, maxDepth = 3) =>
          Effect.gen(function* () {
            const absPath = resolve(path);

            // Path traversal guard
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }

            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }

            const clampedDepth = Math.min(Math.max(1, maxDepth), MAX_IMPACT_DEPTH);
            const uri = `file://${absPath}`;

            // Prepare call hierarchy — find the symbol at the given position
            // First get document symbols to locate the target by name
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);

            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({
                  path: `Symbol '${symbolName}' not found in ${path}`,
                }),
              );
            }

            // Get call hierarchy item at the symbol's position
            const items = yield* lsp.prepareCallHierarchy(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
            );

            if (items.length === 0) {
              return yield* Effect.fail(
                new FileNotFoundError({
                  path: `Call hierarchy not available for '${symbolName}' in ${path}`,
                }),
              );
            }

            // BFS over incomingCalls
            const visited = new Set<string>();
            let highFanOut = false;

            const buildNode = (
              item: CallHierarchyItem,
              depth: number,
            ): Effect.Effect<ImpactNode, LspError | LspTimeoutError> =>
              Effect.gen(function* () {
                const key = `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;

                let callers: ImpactNode[] = [];
                let fanOut = 0;

                if (depth < clampedDepth && !visited.has(key)) {
                  visited.add(key);

                  const calls = yield* lsp.incomingCalls(item);
                  fanOut = calls.length;

                  if (fanOut > HIGH_FAN_OUT_THRESHOLD) {
                    highFanOut = true;
                  }

                  for (const call of calls) {
                    const childKey = `${call.from.uri}:${call.from.selectionRange.start.line}:${call.from.selectionRange.start.character}`;
                    if (!visited.has(childKey)) {
                      const node = yield* buildNode(call.from, depth + 1);
                      callers.push(node);
                    }
                  }
                }

                return {
                  name: item.name,
                  kind: item.kind,
                  uri: item.uri,
                  range: item.selectionRange,
                  fanOut,
                  callers,
                };
              });

            const root = yield* buildNode(items[0], 0);

            // Count total nodes (including root)
            const countNodes = (node: ImpactNode): number =>
              1 + node.callers.reduce((sum, c) => sum + countNodes(c), 0);

            return {
              symbol: symbolName,
              path: absPath,
              depth: clampedDepth,
              maxDepth: MAX_IMPACT_DEPTH,
              totalNodes: countNodes(root),
              highFanOut,
              root,
            };
          }),

        deps: (path, symbolName, maxDepth = 3) =>
          Effect.gen(function* () {
            const absPath = resolve(path);

            // Path traversal guard
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }

            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }

            const clampedDepth = Math.min(Math.max(1, maxDepth), MAX_IMPACT_DEPTH);
            const uri = `file://${absPath}`;

            // Find the symbol by name
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);

            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({
                  path: `Symbol '${symbolName}' not found in ${path}`,
                }),
              );
            }

            // Get call hierarchy item at the symbol's position
            const items = yield* lsp.prepareCallHierarchy(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
            );

            if (items.length === 0) {
              return yield* Effect.fail(
                new FileNotFoundError({
                  path: `Call hierarchy not available for '${symbolName}' in ${path}`,
                }),
              );
            }

            // BFS over outgoingCalls
            const visited = new Set<string>();
            let highFanOut = false;

            const buildNode = (
              item: CallHierarchyItem,
              depth: number,
            ): Effect.Effect<DepsNode, LspError | LspTimeoutError> =>
              Effect.gen(function* () {
                const key = `${item.uri}:${item.selectionRange.start.line}:${item.selectionRange.start.character}`;

                let callees: DepsNode[] = [];
                let fanOut = 0;

                if (depth < clampedDepth && !visited.has(key)) {
                  visited.add(key);

                  const calls = yield* lsp.outgoingCalls(item);
                  fanOut = calls.length;

                  if (fanOut > HIGH_FAN_OUT_THRESHOLD) {
                    highFanOut = true;
                  }

                  for (const call of calls) {
                    const childKey = `${call.to.uri}:${call.to.selectionRange.start.line}:${call.to.selectionRange.start.character}`;
                    if (!visited.has(childKey)) {
                      const node = yield* buildNode(call.to, depth + 1);
                      callees.push(node);
                    }
                  }
                }

                return {
                  name: item.name,
                  kind: item.kind,
                  uri: item.uri,
                  range: item.selectionRange,
                  fanOut,
                  callees,
                };
              });

            const root = yield* buildNode(items[0], 0);

            // Count total nodes (including root)
            const countNodes = (node: DepsNode): number =>
              1 + node.callees.reduce((sum, c) => sum + countNodes(c), 0);

            return {
              symbol: symbolName,
              path: absPath,
              depth: clampedDepth,
              maxDepth: MAX_IMPACT_DEPTH,
              totalNodes: countNodes(root),
              highFanOut,
              root,
            };
          }),

        references: (path, symbolName, includeDeclaration = true) =>
          Effect.gen(function* () {
            const absPath = resolve(path);

            // Path traversal guard
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }

            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }

            const uri = `file://${absPath}`;

            // Find the symbol by name
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);

            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({
                  path: `Symbol '${symbolName}' not found in ${path}`,
                }),
              );
            }

            // Get references at the symbol's position
            const locations = yield* lsp.references(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
              includeDeclaration,
            );

            const references = locations.map((loc) => ({
              path: loc.uri.replace("file://", ""),
              line: loc.range.start.line,
              character: loc.range.start.character,
            }));

            return {
              symbol: symbolName,
              path: absPath,
              references,
              totalReferences: references.length,
              includesDeclaration: includeDeclaration,
            };
          }),

        rename: (path, symbolName, newName) =>
          Effect.gen(function* () {
            const absPath = resolve(path);

            // Path traversal guard
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }

            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }

            const uri = `file://${absPath}`;

            // Find the symbol by name
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);

            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({
                  path: `Symbol '${symbolName}' not found in ${path}`,
                }),
              );
            }

            // Request rename from LSP
            const edit = yield* lsp.rename(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
              newName,
            );

            if (!edit || !edit.changes) {
              return yield* Effect.fail(
                new FileNotFoundError({
                  path: `Rename not available for '${symbolName}' in ${path}`,
                }),
              );
            }

            // Apply edits — process each file, applying text edits in reverse order
            const filesModified: string[] = [];
            let totalEdits = 0;

            for (const [fileUri, edits] of Object.entries(edit.changes)) {
              const filePath = fileUri.replace("file://", "");

              // Workspace boundary check for each affected file
              if (!filePath.startsWith(rootDir + "/") && filePath !== rootDir) continue;

              const content = readFileSync(filePath, "utf-8");
              const lines = content.split("\n");

              // Sort edits in reverse order (bottom-up) so offsets don't shift
              const sorted = [...edits].sort((a: TextEdit, b: TextEdit) => {
                if (a.range.start.line !== b.range.start.line)
                  return b.range.start.line - a.range.start.line;
                return b.range.start.character - a.range.start.character;
              });

              let result = content;
              for (const textEdit of sorted) {
                const startOffset = linesToOffset(
                  lines,
                  textEdit.range.start.line,
                  textEdit.range.start.character,
                );
                const endOffset = linesToOffset(
                  lines,
                  textEdit.range.end.line,
                  textEdit.range.end.character,
                );
                result = result.slice(0, startOffset) + textEdit.newText + result.slice(endOffset);
              }

              writeFileSync(filePath, result);
              filesModified.push(filePath);
              totalEdits += edits.length;

              // Notify LSP about the change
              yield* lsp.updateOpenDocument(fileUri);
            }

            return {
              symbol: symbolName,
              newName,
              path: absPath,
              filesModified,
              totalEdits,
            };
          }),
      });
    }),
  );

// ── Helpers ──

/** Convert line:character to byte offset within file content. */
function linesToOffset(lines: string[], line: number, character: number): number {
  let offset = 0;
  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i].length + 1; // +1 for newline
  }
  return offset + character;
}

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
