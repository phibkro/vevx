import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { Context, Effect, Layer } from "effect";

import { buildDeclarations, isCacheStale, readDeclaration } from "./core/DeclCache.js";
import { FileNotFoundError, LspError, LspTimeoutError } from "./core/Errors.js";
import { isExported } from "./core/ExportDetection.js";
import { parseSymbols } from "./core/OxcSymbols.js";
import { extractDocComment, extractSignature, symbolKindName } from "./core/Signatures.js";
import { extractTypeReferences, resolveTypeOrigins } from "./core/TypeRefs.js";
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
  ZoomFileResult,
} from "./core/types.js";
import type { ZoomResult, ZoomSymbol } from "./core/types.js";
import { LspClient } from "./Lsp.js";

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
} from "./core/types.js";

// ── Constants ──

const MAX_IMPACT_DEPTH = 5; // Hard cap on BFS depth to prevent full-graph traversal
const HIGH_FAN_OUT_THRESHOLD = 10; // Warn agents when fan-out exceeds this

// ── Zoom options ──

type ZoomOptions = {
  depth: number;
  visibility: "exported" | "all";
  kind?: string[];
  deep: boolean;
};

// ── Symbol conversion ──

function toZoomSymbol(
  symbol: DocumentSymbol,
  lines: string[],
  maxChildDepth = Infinity,
): ZoomSymbol {
  const kind = symbolKindName(symbol.kind);
  const signature = extractSignature(symbol, lines);
  const doc = extractDocComment(symbol, lines);
  const exported = isExported(symbol, lines);

  const children =
    maxChildDepth > 0 && symbol.children && symbol.children.length > 0
      ? symbol.children.map((c) => toZoomSymbol(c, lines, maxChildDepth - 1))
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
      opts: ZoomOptions,
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
        zoom: (path, opts) =>
          Effect.gen(function* () {
            const absPath = resolve(path);
            const { depth, visibility, kind, deep } = opts;

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
              return yield* zoomDirectory(lsp, absPath, opts, rootDir);
            }

            // Rust files: keep tree-sitter + LSP path
            if (absPath.endsWith(".rs")) {
              const uri = `file://${absPath}`;
              const symbols = yield* lsp.documentSymbol(uri);
              const fileContent = readFileSync(absPath, "utf-8");
              const lines = fileContent.split("\n");

              let zoomSymbols = symbols.map((s) => toZoomSymbol(s, lines, 1));
              if (visibility === "exported") {
                zoomSymbols = zoomSymbols.filter((s) => s.exported);
              }
              if (kind) {
                zoomSymbols = zoomSymbols.filter((s) => kind.includes(s.kind));
              }

              return { path: absPath, depth, symbols: zoomSymbols };
            }

            // TypeScript files: DeclCache path for visibility=exported
            if (visibility === "exported") {
              // Ensure DeclCache is fresh
              if (isCacheStale(rootDir)) {
                yield* Effect.promise(() => buildDeclarations(rootDir));
              }

              let primaryDts = readDeclaration(rootDir, absPath);
              if (!primaryDts) {
                // Cache miss — build and retry
                yield* Effect.promise(() => buildDeclarations(rootDir));
                primaryDts = readDeclaration(rootDir, absPath);
              }

              if (primaryDts) {
                // Apply kind filter by stripping non-matching declarations
                if (kind) {
                  primaryDts = filterDtsByKind(primaryDts, kind);
                }

                // BFS for referenced files at depth > 0
                const referencedFiles: ZoomFileResult[] = [];
                if (depth > 0) {
                  const visited = new Set<string>([absPath]);
                  let frontier: Array<{ path: string; content: string }> = [
                    { path: absPath, content: primaryDts },
                  ];

                  for (let hop = 0; hop < depth; hop++) {
                    const nextFrontier: Array<{ path: string; content: string }> = [];
                    for (const { path: originPath, content: dtsContent } of frontier) {
                      const refs = extractTypeReferences(dtsContent, deep);
                      const origins = resolveTypeOrigins(dtsContent);
                      for (const ref of refs) {
                        const specifier = origins.get(ref);
                        if (!specifier) continue;
                        // Skip external packages (no relative path)
                        if (!specifier.startsWith(".")) continue;
                        // Resolve specifier relative to the file it was imported from
                        const refPath = resolve(
                          dirname(originPath),
                          specifier.replace(/\.js$/, ".ts"),
                        );
                        if (visited.has(refPath)) continue;
                        visited.add(refPath);
                        const refDts = readDeclaration(rootDir, refPath);
                        if (refDts) {
                          referencedFiles.push({ path: refPath, content: refDts });
                          nextFrontier.push({ path: refPath, content: refDts });
                        }
                      }
                    }
                    frontier = nextFrontier;
                  }
                }

                return {
                  path: absPath,
                  depth,
                  symbols: [
                    {
                      name: absPath.split("/").pop() ?? absPath,
                      kind: "declarations",
                      signature: primaryDts,
                      doc: null,
                      exported: true,
                    },
                  ],
                  ...(referencedFiles.length > 0 ? { referencedFiles } : {}),
                };
              }

              // DeclCache unavailable (no tsc) — fall through to LSP path
            }

            // Fallback: LSP + documentSymbol path (visibility=all or DeclCache unavailable)
            const uri = `file://${absPath}`;
            const symbols = yield* lsp.documentSymbol(uri);
            const fileContent = readFileSync(absPath, "utf-8");
            const lines = fileContent.split("\n");

            const maxChildDepth = visibility === "exported" ? 0 : 1;
            let zoomSymbols = symbols.map((s) => toZoomSymbol(s, lines, maxChildDepth));
            if (visibility === "exported") {
              zoomSymbols = zoomSymbols.filter((s) => s.exported);
            }
            if (kind) {
              zoomSymbols = zoomSymbols.filter((s) => kind.includes(s.kind));
            }

            return { path: absPath, depth, symbols: zoomSymbols };
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
  opts: ZoomOptions,
  rootDir: string,
): Effect.Effect<ZoomResult, LspError | LspTimeoutError | FileNotFoundError> {
  return Effect.gen(function* () {
    const { depth, visibility, kind } = opts;
    const entries = readdirSync(dirPath);
    const sourceFiles = entries
      .filter((e) => e.endsWith(".ts") || e.endsWith(".tsx") || e.endsWith(".rs"))
      .filter((e) => !e.endsWith(".test.ts") && !e.endsWith(".test.tsx") && !e.endsWith("_test.rs"))
      .sort();

    // Depth 0 compact mode: export counts via oxc-parser (no LSP needed)
    if (depth === 0 && visibility === "exported") {
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
          depth: 0,
          symbols: [
            { name: file, kind: "file", signature: `${exportCount} exports`, exported: true },
          ],
        });
      }
      return { path: dirPath, depth: 0, symbols: [], files: fileResults };
    }

    // Depth 1+: use DeclCache for TS files, LSP for Rust
    const fileResults: ZoomResult[] = [];

    // Ensure DeclCache is fresh for TS files
    if (isCacheStale(rootDir)) {
      yield* Effect.promise(() => buildDeclarations(rootDir));
    }

    for (const file of sourceFiles) {
      const filePath = resolve(dirPath, file);

      // Try DeclCache for TS files with visibility=exported
      if (!file.endsWith(".rs") && visibility === "exported") {
        const dts = readDeclaration(rootDir, filePath);
        if (dts) {
          let filteredDts = kind ? filterDtsByKind(dts, kind) : dts;
          if (filteredDts.trim()) {
            fileResults.push({
              path: filePath,
              depth,
              symbols: [
                {
                  name: file,
                  kind: "declarations",
                  signature: filteredDts,
                  doc: null,
                  exported: true,
                },
              ],
            });
          }
          continue;
        }
      }

      // LSP fallback (Rust files, visibility=all, or no DeclCache)
      const uri = `file://${filePath}`;
      const fileContent = readFileSync(filePath, "utf-8");
      const lines = fileContent.split("\n");
      const symbols = yield* lsp.documentSymbol(uri);
      let zoomSymbols = symbols.map((s) => toZoomSymbol(s, lines, 1));

      if (visibility === "exported") {
        zoomSymbols = zoomSymbols.filter((s) => s.exported);
      }
      if (kind) {
        zoomSymbols = zoomSymbols.filter((s) => kind.includes(s.kind));
      }
      if (zoomSymbols.length === 0) continue;

      fileResults.push({
        path: filePath,
        depth: 0,
        symbols: zoomSymbols,
      });
    }

    return { path: dirPath, depth, symbols: [], files: fileResults };
  });
}

// ── Plaintext formatting ──

/** Format a ZoomResult as compact plaintext for agent consumption. */
export function formatZoomPlaintext(result: ZoomResult, rootDir?: string): string {
  const relPath = rootDir ? result.path.replace(rootDir + "/", "") : result.path;

  // Directory zoom: list files with export counts or per-file declarations
  if (result.files && result.files.length > 0) {
    const lines = [`// ${relPath}/`];
    for (const f of result.files) {
      const fRel = rootDir ? f.path.replace(rootDir + "/", "") : f.path;
      if (f.symbols.length === 1 && f.symbols[0].kind === "file") {
        lines.push(`  ${fRel}  ${f.symbols[0].signature}`);
      } else if (f.symbols.length === 1 && f.symbols[0].kind === "declarations") {
        lines.push(`  // ${fRel}`);
        lines.push(`  ${f.symbols[0].signature}`);
      } else {
        lines.push(`  ${fRel}`);
        for (const s of f.symbols) {
          lines.push(`    ${formatSymbolLine(s)}`);
        }
      }
    }
    return lines.join("\n");
  }

  // File with .d.ts content (declarations kind)
  if (result.symbols.length === 1 && result.symbols[0].kind === "declarations") {
    let output = `// ${relPath}\n${result.symbols[0].signature}`;
    // Append referenced files from BFS traversal
    if (result.referencedFiles) {
      for (const ref of result.referencedFiles) {
        const refRel = rootDir ? ref.path.replace(rootDir + "/", "") : ref.path;
        output += `\n\n// ${refRel}\n${ref.content}`;
      }
    }
    return output;
  }

  // Fallback: symbol-based format (Rust, visibility=all, DeclCache unavailable)
  const lines = [`// ${relPath} (${result.symbols.length} symbols)`];
  for (const s of result.symbols) {
    if (s.doc) lines.push(s.doc);
    lines.push(formatSymbolLine(s));
    if (s.children) {
      for (const c of s.children) {
        lines.push(`  ${formatSymbolLine(c)}`);
      }
    }
  }
  return lines.join("\n");
}

function formatSymbolLine(s: ZoomSymbol): string {
  return s.signature ? s.signature : `${s.kind} ${s.name}`;
}

// ── DeclCache helpers ──

/** Filter .d.ts content to only include declarations matching the given kinds. */
function filterDtsByKind(dts: string, kinds: string[]): string {
  // Simple line-based filter: keep import lines + lines matching kind keywords
  const kindPatterns = kinds.map((k) => {
    switch (k) {
      case "function":
        return /^\s*export\s+(declare\s+)?function\s/;
      case "class":
        return /^\s*export\s+(declare\s+)?class\s/;
      case "interface":
        return /^\s*export\s+(declare\s+)?interface\s/;
      case "type":
        return /^\s*export\s+(declare\s+)?type\s/;
      case "enum":
        return /^\s*export\s+(declare\s+)?(const\s+)?enum\s/;
      case "const":
        return /^\s*export\s+(declare\s+)?const\s/;
      default:
        return new RegExp(`^\\s*export\\s+(declare\\s+)?${k}\\s`);
    }
  });

  const lines = dts.split("\n");
  const result: string[] = [];
  let inBlock = false;
  let braceDepth = 0;

  for (const line of lines) {
    // Always keep import lines
    if (/^\s*import\s/.test(line)) {
      result.push(line);
      continue;
    }

    // If we're tracking a matched block, keep lines until braces balance
    if (inBlock) {
      result.push(line);
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;
      if (braceDepth <= 0) {
        inBlock = false;
        braceDepth = 0;
      }
      continue;
    }

    // Check if this line matches any of the requested kinds
    if (kindPatterns.some((p) => p.test(line))) {
      result.push(line);
      // Track braces for multi-line declarations
      braceDepth = (line.match(/{/g) || []).length - (line.match(/}/g) || []).length;
      if (braceDepth > 0) {
        inBlock = true;
      }
    }
  }

  return result.join("\n");
}
