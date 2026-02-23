/**
 * Rust `use` statement extraction via tree-sitter.
 *
 * Parses top-level `use_declaration` nodes and produces FileImports-compatible
 * output. Handles grouped imports, aliases, glob imports, and `pub use`.
 *
 * Path resolution maps crate-relative (`crate::`) and relative (`self::`, `super::`)
 * paths to filesystem paths. External crate references return null.
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type Parser from "web-tree-sitter";

import { initRustParser, isRustParserReady, parseRustSymbols } from "./RustSymbols.js";
import type { FileImports, ImportEntry } from "./types.js";

// Re-export for convenience
export { initRustParser, isRustParserReady };

// ── Parser access ──

let rustParser: Parser | null = null;

/** Initialize the parser (async). Must be called before sync extraction. */
export async function ensureRustImportParser(): Promise<void> {
  if (rustParser) return;

  const TreeSitter = (await import("web-tree-sitter")).default;
  await TreeSitter.init();

  const wasmPath = resolve(
    import.meta.dir,
    "../../node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm",
  );
  const lang = await TreeSitter.Language.load(wasmPath);

  const parser = new TreeSitter();
  parser.setLanguage(lang);
  rustParser = parser;

  // Also init the RustSymbols parser (used for exported names)
  await initRustParser();
}

// ── Core extraction ──

/** Extract imports and exports from Rust source using tree-sitter. */
export function extractRustFileImports(
  source: string,
  filename: string,
  parser: Parser,
): Omit<FileImports, "path"> {
  if (source.length === 0) return { imports: [], exportedNames: [], isBarrel: false };

  const tree = parser.parse(source);
  const imports: ImportEntry[] = [];
  let hasLocalDecl = false;

  for (const node of tree.rootNode.children) {
    if (node.type === "use_declaration") {
      const isPub = hasVisibility(node);
      const entries = extractUseDeclaration(node, isPub);
      imports.push(...entries);
    } else {
      // Any non-use top-level item counts as a local declaration
      if (node.type !== "line_comment" && node.type !== "block_comment") {
        hasLocalDecl = true;
      }
    }
  }

  // Exported names from pub items (reuse parseRustSymbols)
  const symbols = parseRustSymbols(source, filename);
  const exportedNames = symbols.filter((s) => s.exported).map((s) => s.name);

  // isBarrel: all top-level items are `pub use`, no local declarations
  const isBarrel = imports.length > 0 && imports.every((i) => i.isReExport) && !hasLocalDecl;

  return { imports, exportedNames, isBarrel };
}

/** Extract Rust imports synchronously. Requires ensureRustImportParser() to have been called. */
export function extractRustFileImportsSync(
  source: string,
  filename: string,
): Omit<FileImports, "path"> {
  if (!rustParser) {
    throw new Error("Rust import parser not initialized — call ensureRustImportParser() first");
  }
  return extractRustFileImports(source, filename, rustParser);
}

/** Extract imports from Rust source — async version that initializes parser if needed. */
export async function extractRustFileImportsAsync(
  source: string,
  filename: string,
): Promise<Omit<FileImports, "path">> {
  await ensureRustImportParser();
  return extractRustFileImports(source, filename, rustParser!);
}

// ── Use declaration parsing ──

/**
 * Extract imports from a use_declaration node.
 *
 * Tree-sitter Rust AST child types:
 * - `scoped_identifier`: simple `use foo::bar::Baz;`
 * - `identifier`: simple `use foo;`
 * - `scoped_use_list`: grouped `use foo::{A, B};`
 * - `use_as_clause`: aliased `use foo::Bar as Baz;`
 * - `use_wildcard`: glob `use foo::*;`
 */
function extractUseDeclaration(node: Parser.SyntaxNode, isPub: boolean): ImportEntry[] {
  for (const child of node.children) {
    switch (child.type) {
      case "scoped_use_list":
        return extractScopedUseList(child, isPub);
      case "use_as_clause":
        return extractUseAsClause(child, isPub);
      case "use_wildcard":
        return extractUseWildcard(child, isPub);
      case "scoped_identifier":
        return [makeEntry(child.text, isPub)];
      case "identifier":
        return [makeEntry(child.text, isPub)];
    }
  }
  return [];
}

/** `use foo::{A, B}` — scoped_use_list has path + use_list children. */
function extractScopedUseList(node: Parser.SyntaxNode, isPub: boolean): ImportEntry[] {
  const entries: ImportEntry[] = [];

  // Find the base path (identifier or scoped_identifier before ::)
  let basePath = "";
  for (const child of node.children) {
    if (child.type === "identifier" || child.type === "scoped_identifier") {
      basePath = child.text + "::";
      break;
    }
  }

  // Find the use_list and extract each item
  const useList = findChild(node, "use_list");
  if (!useList) return entries;

  for (const child of useList.children) {
    if (child.type === "identifier") {
      entries.push(makeEntry(basePath + child.text, isPub));
    } else if (child.type === "scoped_identifier") {
      entries.push(makeEntry(basePath + child.text, isPub));
    } else if (child.type === "use_as_clause") {
      entries.push(...extractUseAsClause(child, isPub, basePath));
    } else if (child.type === "use_wildcard") {
      entries.push(...extractUseWildcard(child, isPub, basePath));
    } else if (child.type === "scoped_use_list") {
      entries.push(...extractScopedUseList(child, isPub));
    }
  }

  return entries;
}

/** `use foo::Bar as Baz` — use_as_clause has path + alias children. */
function extractUseAsClause(node: Parser.SyntaxNode, isPub: boolean, prefix = ""): ImportEntry[] {
  // Children: scoped_identifier | identifier, "as", identifier
  let pathText = "";
  let aliasText = "";
  let seenAs = false;

  for (const child of node.children) {
    if (child.type === "as") {
      seenAs = true;
    } else if (child.type === "identifier" || child.type === "scoped_identifier") {
      if (seenAs) {
        aliasText = child.text;
      } else {
        pathText = child.text;
      }
    }
  }

  if (!pathText) return [];
  const name = aliasText || lastSegment(pathText);
  return [
    {
      specifier: prefix + pathText,
      resolvedPath: null,
      importedNames: [name],
      isTypeOnly: false,
      isReExport: isPub,
    },
  ];
}

/** `use foo::*` — use_wildcard has path + `*` children. */
function extractUseWildcard(node: Parser.SyntaxNode, isPub: boolean, prefix = ""): ImportEntry[] {
  // Find the path prefix
  let pathText = "";
  for (const child of node.children) {
    if (child.type === "identifier" || child.type === "scoped_identifier") {
      pathText = child.text;
      break;
    }
  }

  return [
    {
      specifier: prefix + pathText,
      resolvedPath: null,
      importedNames: [],
      isTypeOnly: false,
      isReExport: isPub,
    },
  ];
}

// ── Path resolution ──

/**
 * Resolve a Rust use path to a filesystem path.
 *
 * - `crate::foo::bar` → `{crateRoot}/src/foo/bar.rs` or `.../foo/bar/mod.rs`
 * - `self::foo` → `{fromDir}/foo.rs` or `{fromDir}/foo/mod.rs`
 * - `super::foo` → `{fromDir}/../foo.rs` or `{fromDir}/../foo/mod.rs`
 * - External crates → `null`
 */
export function rustResolve(specifier: string, fromDir: string, crateRoot?: string): string | null {
  const segments = specifier.split("::");
  if (segments.length === 0) return null;

  const first = segments[0];
  let baseDir: string;
  let pathSegments: string[];

  if (first === "crate") {
    if (!crateRoot) return null;
    baseDir = join(crateRoot, "src");
    pathSegments = segments.slice(1);
  } else if (first === "self") {
    baseDir = fromDir;
    pathSegments = segments.slice(1);
  } else if (first === "super") {
    baseDir = dirname(fromDir);
    pathSegments = segments.slice(1);
    // Handle chained super::super::
    while (pathSegments[0] === "super") {
      baseDir = dirname(baseDir);
      pathSegments = pathSegments.slice(1);
    }
  } else {
    // External crate
    return null;
  }

  if (pathSegments.length === 0) return null;

  // Drop the last segment (it's the item name, not a module path)
  // unless the path resolves to a file
  const fullPath = join(baseDir, ...pathSegments);

  // Try as file: foo/bar.rs
  const asFile = fullPath + ".rs";
  if (existsSync(asFile)) return asFile;

  // Try as directory module: foo/bar/mod.rs
  const asMod = join(fullPath, "mod.rs");
  if (existsSync(asMod)) return asMod;

  // Try without last segment (item inside a module)
  if (pathSegments.length > 1) {
    const modulePath = join(baseDir, ...pathSegments.slice(0, -1));
    const moduleFile = modulePath + ".rs";
    if (existsSync(moduleFile)) return moduleFile;
    const moduleMod = join(modulePath, "mod.rs");
    if (existsSync(moduleMod)) return moduleMod;
  }

  return null;
}

// ── Helpers ──

function hasVisibility(node: Parser.SyntaxNode): boolean {
  for (const child of node.children) {
    if (child.type === "visibility_modifier") return true;
  }
  return false;
}

function findChild(node: Parser.SyntaxNode, type: string): Parser.SyntaxNode | undefined {
  for (const child of node.children) {
    if (child.type === type) return child;
  }
  return undefined;
}

function lastSegment(path: string): string {
  const parts = path.split("::");
  return parts[parts.length - 1];
}

function makeEntry(specifier: string, isPub: boolean): ImportEntry {
  const name = lastSegment(specifier);
  return {
    specifier,
    resolvedPath: null,
    importedNames: [name],
    isTypeOnly: false,
    isReExport: isPub,
  };
}
