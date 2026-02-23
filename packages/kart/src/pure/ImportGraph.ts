/**
 * Import graph construction using oxc-parser AST.
 *
 * Pure module — takes pre-loaded source map + injectable resolver.
 * No filesystem or LSP dependency.
 */

import { dirname } from "node:path";
import { parseSync } from "oxc-parser";

import type { ResolveFn } from "./Resolve.js";
import type { FileImports, ImportEntry, ImportGraph, ImportersResult } from "./types.js";

// ── AST node types ──

const IMPORT_DECLARATION = "ImportDeclaration";
const EXPORT_NAMED = "ExportNamedDeclaration";
const EXPORT_ALL = "ExportAllDeclaration";
const EXPORT_DEFAULT = "ExportDefaultDeclaration";

// Declaration types that produce local exports (not re-exports)
const DECLARATION_KINDS = new Set([
  "FunctionDeclaration",
  "ClassDeclaration",
  "TSInterfaceDeclaration",
  "TSTypeAliasDeclaration",
  "TSEnumDeclaration",
  "VariableDeclaration",
]);

// ── Import extraction ──

/** Extract all import/export-from statements and exported names from source using oxc AST. */
export function extractFileImports(source: string, filename: string): Omit<FileImports, "path"> {
  const lang = filename.endsWith(".tsx") ? "tsx" : "ts";
  const result = parseSync(filename, source, { lang, sourceType: "module" });
  const body: any[] = (result as any).program.body;

  const imports: ImportEntry[] = [];
  const exportedNames: string[] = [];
  let hasLocalExport = false;

  for (const node of body) {
    if (node.type === IMPORT_DECLARATION) {
      imports.push(importFromDeclaration(node));
    } else if (node.type === EXPORT_ALL && node.source) {
      // export * from "./foo.js"
      imports.push({
        specifier: node.source.value,
        resolvedPath: null,
        importedNames: [],
        isTypeOnly: node.exportKind === "type",
        isReExport: true,
      });
    } else if (node.type === EXPORT_NAMED) {
      if (node.source) {
        // export { foo } from "./foo.js" — re-export
        const names = node.specifiers.map((s: any) => s.local.name);
        imports.push({
          specifier: node.source.value,
          resolvedPath: null,
          importedNames: names,
          isTypeOnly: node.exportKind === "type",
          isReExport: true,
        });
        exportedNames.push(...names);
      } else if (node.declaration) {
        // export function foo() {} — local export
        hasLocalExport = true;
        const name = extractDeclName(node.declaration);
        if (name) exportedNames.push(name);
      } else if (node.specifiers?.length > 0 && !node.source) {
        // export { foo } — re-export of local binding, counts as local
        hasLocalExport = true;
        for (const s of node.specifiers) {
          exportedNames.push(s.exported?.name ?? s.local.name);
        }
      }
    } else if (node.type === EXPORT_DEFAULT) {
      hasLocalExport = true;
      const name = node.declaration?.id?.name ?? "default";
      exportedNames.push(name);
    }
  }

  const isBarrel = imports.some((i) => i.isReExport) && !hasLocalExport;

  return { imports, exportedNames, isBarrel };
}

function importFromDeclaration(node: any): ImportEntry {
  const specifiers: any[] = node.specifiers ?? [];
  const names: string[] = [];

  for (const s of specifiers) {
    if (s.type === "ImportSpecifier") {
      names.push(s.imported.name);
    } else if (s.type === "ImportDefaultSpecifier") {
      names.push("default");
    }
    // ImportNamespaceSpecifier: no individual names
  }

  return {
    specifier: node.source.value,
    resolvedPath: null,
    importedNames: names,
    isTypeOnly: node.importKind === "type",
    isReExport: false,
  };
}

function extractDeclName(decl: any): string | null {
  if (!DECLARATION_KINDS.has(decl.type)) return null;
  if (decl.type === "VariableDeclaration") {
    return decl.declarations?.[0]?.id?.name ?? null;
  }
  return decl.id?.name ?? null;
}

// ── Graph construction ──

/**
 * Build an import graph from pre-loaded sources.
 *
 * @param sources - Map from absolute file path to source content
 * @param resolveFn - Resolves (specifier, fromDir) → absolute path or null
 */
export function buildImportGraph(
  sources: ReadonlyMap<string, string>,
  resolveFn: ResolveFn,
): ImportGraph {
  const start = performance.now();
  const files = new Map<string, FileImports>();
  let importCount = 0;

  for (const [filePath, source] of sources) {
    const extracted = extractFileImports(source, filePath);
    const fromDir = dirname(filePath);

    // Resolve all import specifiers
    const resolved: ImportEntry[] = extracted.imports.map((imp) => ({
      ...imp,
      resolvedPath: resolveFn(imp.specifier, fromDir),
    }));

    importCount += resolved.length;

    files.set(filePath, {
      path: filePath,
      imports: resolved,
      exportedNames: extracted.exportedNames,
      isBarrel: extracted.isBarrel,
    });
  }

  return {
    files,
    fileCount: sources.size,
    importCount,
    durationMs: Math.round(performance.now() - start),
  };
}

// ── Graph queries ──

/** Build a reverse index: target path → files that import it. */
function buildReverseIndex(graph: ImportGraph): Map<string, string[]> {
  const reverse = new Map<string, string[]>();

  for (const [filePath, fileImports] of graph.files) {
    for (const imp of fileImports.imports) {
      if (!imp.resolvedPath) continue;
      const existing = reverse.get(imp.resolvedPath);
      if (existing) {
        existing.push(filePath);
      } else {
        reverse.set(imp.resolvedPath, [filePath]);
      }
    }
  }

  return reverse;
}

/**
 * Find all files that import the given file, expanding through barrel files.
 *
 * Direct importers: files whose import statements resolve to `targetPath`.
 * Barrel importers: files that import a barrel which re-exports from `targetPath`.
 */
export function transitiveImporters(
  targetPath: string,
  graph: ImportGraph,
): Omit<ImportersResult, "path"> {
  const reverse = buildReverseIndex(graph);
  const directImporters = reverse.get(targetPath) ?? [];

  // Expand through barrels: find barrel files that import targetPath,
  // then find importers of those barrels (recursively).
  const barrelImporters: string[] = [];
  const visited = new Set<string>([targetPath]);

  const barrelQueue = directImporters.filter((p) => graph.files.get(p)?.isBarrel);
  for (const barrel of barrelQueue) {
    if (visited.has(barrel)) continue;
    visited.add(barrel);

    const barrelConsumers = reverse.get(barrel) ?? [];
    for (const consumer of barrelConsumers) {
      if (visited.has(consumer)) continue;

      if (graph.files.get(consumer)?.isBarrel) {
        // Nested barrel — continue expanding
        barrelQueue.push(consumer);
      } else {
        barrelImporters.push(consumer);
        visited.add(consumer);
      }
    }
  }

  const allImporters = new Set([...directImporters, ...barrelImporters]);

  return {
    directImporters: directImporters.sort(),
    barrelImporters: barrelImporters.sort(),
    totalImporters: allImporters.size,
  };
}
