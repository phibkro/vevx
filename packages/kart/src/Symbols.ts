import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Effect, Layer } from "effect";

import { LspClient } from "./Lsp.js";
import { FileNotFoundError, LspError, LspTimeoutError } from "./pure/Errors.js";
import { isExported } from "./pure/ExportDetection.js";
import { parseSymbols } from "./pure/OxcSymbols.js";
import { extractDocComment, extractSignature, symbolKindName } from "./pure/Signatures.js";
import type {
  CallHierarchyItem,
  CodeActionsResult,
  DefinitionResult,
  DepsNode,
  DepsResult,
  DocumentSymbol,
  ExpandMacroResult,
  ImpactNode,
  ImpactResult,
  ImplementationResult,
  InlayHintsResult,
  ReferencesResult,
  RenameResult,
  TextEdit,
  TypeDefinitionResult,
  WorkspaceSymbolResult,
} from "./pure/types.js";
import type { ZoomResult, ZoomSymbol } from "./pure/types.js";

export type {
  CodeActionsResult,
  DefinitionResult,
  DepsResult,
  ExpandMacroResult,
  ImpactResult,
  ImplementationResult,
  InlayHintsResult,
  ReferencesResult,
  RenameResult,
  TypeDefinitionResult,
  WorkspaceSymbolResult,
  ZoomResult,
  ZoomSymbol,
} from "./pure/types.js";

// ── Constants ──

const MAX_LEVEL2_BYTES = 100 * 1024; // 100KB cap for level-2 full file content
const MAX_IMPACT_DEPTH = 5; // Hard cap on BFS depth to prevent full-graph traversal
const HIGH_FAN_OUT_THRESHOLD = 10; // Warn agents when fan-out exceeds this

// ── Symbol conversion ──

// ── Hover enrichment ──

/** Strip markdown code fence wrapper from hover response. */
function extractTypeFromHover(contents: string): string {
  const match = contents.match(/```\w*\n([\s\S]*?)\n```/);
  return match ? match[1].trim() : contents.trim();
}

/** Batch hover calls for zoom symbols, zip resolved types onto results. */
function enrichWithResolvedTypes(
  lsp: Context.Tag.Service<typeof LspClient>,
  uri: string,
  docSymbols: readonly DocumentSymbol[],
  zoomSymbols: ZoomSymbol[],
): Effect.Effect<ZoomSymbol[], LspError | LspTimeoutError> {
  return Effect.gen(function* () {
    const symbolNames = new Set(zoomSymbols.map((s) => s.name));
    const positions = docSymbols
      .filter((s) => symbolNames.has(s.name))
      .map((s) => ({
        name: s.name,
        line: s.selectionRange.start.line,
        char: s.selectionRange.start.character,
      }));

    const hoverMap = new Map<string, string>();
    for (const pos of positions) {
      const result = yield* lsp.hover(uri, pos.line, pos.char);
      if (result) {
        hoverMap.set(pos.name, extractTypeFromHover(result.contents));
      }
    }

    return zoomSymbols.map((s) => {
      const resolved = hoverMap.get(s.name);
      return resolved ? { ...s, resolvedType: resolved } : s;
    });
  });
}

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
      resolveTypes?: boolean,
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
    readonly definition: (
      path: string,
      symbolName: string,
    ) => Effect.Effect<DefinitionResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly typeDefinition: (
      path: string,
      symbolName: string,
    ) => Effect.Effect<TypeDefinitionResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly implementation: (
      path: string,
      symbolName: string,
    ) => Effect.Effect<ImplementationResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly codeActions: (
      path: string,
      symbolName: string,
    ) => Effect.Effect<CodeActionsResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly expandMacro: (
      path: string,
      symbolName: string,
    ) => Effect.Effect<ExpandMacroResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly inlayHints: (
      path: string,
      range?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
      },
    ) => Effect.Effect<InlayHintsResult, LspError | LspTimeoutError | FileNotFoundError>;
    readonly workspaceSymbol: (
      query: string,
    ) => Effect.Effect<WorkspaceSymbolResult, LspError | LspTimeoutError>;
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
        zoom: (path, level, resolveTypes = true) =>
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
              return yield* zoomDirectory(lsp, absPath, level);
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

            // Enrich with LSP-resolved types
            if (resolveTypes) {
              zoomSymbols = yield* enrichWithResolvedTypes(lsp, uri, symbols, zoomSymbols);
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

        definition: (path, symbolName) =>
          Effect.gen(function* () {
            const absPath = resolve(path);
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }
            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }
            const uri = `file://${absPath}`;
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);
            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Symbol '${symbolName}' not found in ${path}` }),
              );
            }
            const locations = yield* lsp.definition(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
            );
            const definitions = locations.map((loc) => ({
              path: loc.uri.replace("file://", ""),
              line: loc.range.start.line,
              character: loc.range.start.character,
            }));
            return {
              symbol: symbolName,
              path: absPath,
              definitions,
              totalDefinitions: definitions.length,
            };
          }),

        typeDefinition: (path, symbolName) =>
          Effect.gen(function* () {
            const absPath = resolve(path);
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }
            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }
            const uri = `file://${absPath}`;
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);
            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Symbol '${symbolName}' not found in ${path}` }),
              );
            }
            const locations = yield* lsp.typeDefinition(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
            );
            const typeDefinitions = locations.map((loc) => ({
              path: loc.uri.replace("file://", ""),
              line: loc.range.start.line,
              character: loc.range.start.character,
            }));
            return {
              symbol: symbolName,
              path: absPath,
              typeDefinitions,
              totalTypeDefinitions: typeDefinitions.length,
            };
          }),

        implementation: (path, symbolName) =>
          Effect.gen(function* () {
            const absPath = resolve(path);
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }
            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }
            const uri = `file://${absPath}`;
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);
            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Symbol '${symbolName}' not found in ${path}` }),
              );
            }
            const locations = yield* lsp.implementation(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
            );
            const implementations = locations.map((loc) => ({
              path: loc.uri.replace("file://", ""),
              line: loc.range.start.line,
              character: loc.range.start.character,
            }));
            return {
              symbol: symbolName,
              path: absPath,
              implementations,
              totalImplementations: implementations.length,
            };
          }),

        codeActions: (path, symbolName) =>
          Effect.gen(function* () {
            const absPath = resolve(path);
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }
            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }
            const uri = `file://${absPath}`;
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);
            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Symbol '${symbolName}' not found in ${path}` }),
              );
            }
            const raw = yield* lsp.codeAction(uri, target.selectionRange);
            const actions = raw.map((a: Record<string, unknown>) => ({
              title: a.title as string,
              kind: a.kind as string | undefined,
              isPreferred: a.isPreferred as boolean | undefined,
              diagnostics: Array.isArray(a.diagnostics)
                ? a.diagnostics.map((d: Record<string, unknown>) => ({
                    message: d.message as string,
                    severity: d.severity as number | undefined,
                  }))
                : undefined,
            }));
            return {
              symbol: symbolName,
              path: absPath,
              actions,
              totalActions: actions.length,
            };
          }),

        expandMacro: (path, symbolName) =>
          Effect.gen(function* () {
            const absPath = resolve(path);
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }
            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }
            const uri = `file://${absPath}`;
            const symbols = yield* lsp.documentSymbol(uri);
            const target = findSymbolByName(symbols, symbolName);
            if (!target) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Symbol '${symbolName}' not found in ${path}` }),
              );
            }
            const result = yield* lsp.expandMacro(
              uri,
              target.selectionRange.start.line,
              target.selectionRange.start.character,
            );
            if (!result) {
              return { symbol: symbolName, path: absPath, name: symbolName, expansion: "" };
            }
            return {
              symbol: symbolName,
              path: absPath,
              name: result.name,
              expansion: result.expansion,
            };
          }),

        inlayHints: (path, range) =>
          Effect.gen(function* () {
            const absPath = resolve(path);
            if (!absPath.startsWith(rootDir + "/") && absPath !== rootDir) {
              return yield* Effect.fail(
                new FileNotFoundError({ path: `Access denied: ${path} is outside workspace root` }),
              );
            }
            if (!existsSync(absPath)) {
              return yield* Effect.fail(new FileNotFoundError({ path: absPath }));
            }
            const uri = `file://${absPath}`;

            // If no range provided, use the full file
            const effectiveRange = range ?? {
              start: { line: 0, character: 0 },
              end: { line: readFileSync(absPath, "utf-8").split("\n").length, character: 0 },
            };

            const hints = yield* lsp.inlayHints(uri, effectiveRange);
            return { path: absPath, hints, totalHints: hints.length };
          }),

        workspaceSymbol: (query) =>
          Effect.gen(function* () {
            const symbols = yield* lsp.workspaceSymbol(query);
            return { query, symbols, totalSymbols: symbols.length };
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
  level: 0 | 1 | 2 = 0,
): Effect.Effect<ZoomResult, LspError | LspTimeoutError | FileNotFoundError> {
  return Effect.gen(function* () {
    const entries = readdirSync(dirPath);
    const sourceFiles = entries
      .filter((e) => e.endsWith(".ts") || e.endsWith(".tsx") || e.endsWith(".rs"))
      .filter((e) => !e.endsWith(".test.ts") && !e.endsWith(".test.tsx") && !e.endsWith("_test.rs"))
      .sort();

    // Level 0 compact mode: export counts via oxc-parser (no LSP needed)
    if (level === 0) {
      const fileResults: ZoomResult[] = [];
      for (const file of sourceFiles) {
        const filePath = resolve(dirPath, file);
        const content = readFileSync(filePath, "utf-8");
        const exportCount = file.endsWith(".rs")
          ? 0 // Rust export counting not supported via oxc
          : parseSymbols(content, file).filter((s) => s.exported).length;
        if (exportCount === 0) continue;
        fileResults.push({
          path: filePath,
          level: 0,
          symbols: [
            { name: file, kind: "file", signature: `${exportCount} exports`, exported: true },
          ],
          truncated: true,
        });
      }
      return { path: dirPath, level: 0 as const, symbols: [], truncated: true, files: fileResults };
    }

    // Level 1+: full LSP-based zoom with symbol signatures
    const fileResults: ZoomResult[] = [];

    for (const file of sourceFiles) {
      const filePath = resolve(dirPath, file);
      const uri = `file://${filePath}`;
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");

      const symbols = yield* lsp.documentSymbol(uri);
      let zoomSymbols = symbols.map((s) => toZoomSymbol(s, lines)).filter((s) => s.exported);

      // Omit files with no exports
      if (zoomSymbols.length === 0) continue;

      // Enrich with LSP-resolved types
      zoomSymbols = yield* enrichWithResolvedTypes(lsp, uri, symbols, zoomSymbols);

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
