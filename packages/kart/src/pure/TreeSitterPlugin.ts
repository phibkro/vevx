/**
 * Generic tree-sitter AST plugin factory.
 *
 * Uses tree-sitter's query language (S-expression patterns) for symbol
 * extraction. Languages provide a grammar config with a `symbolQuery`
 * string using the tags.scm convention:
 *
 *   - `@definition.X` captures identify symbol kind (stripped to "X")
 *   - `@name` captures identify symbol name
 *
 * Pure functions except parser initialization (async WASM load).
 */

import { resolve } from "node:path";

import { Option } from "effect";
import type Parser from "web-tree-sitter";

import type { AstPlugin } from "../Plugin.js";
import type { SymbolRange } from "./AstEdit.js";
import type { OxcSymbol } from "./OxcSymbols.js";

// ── Types ──

export type TreeSitterGrammar = {
  /** Language name for error messages */
  readonly language: string;
  /** WASM filename in tree-sitter-wasms/out/ (e.g., "tree-sitter-php.wasm") */
  readonly wasmFile: string;
  /** S-expression query for symbol extraction (tags.scm style).
   *  Must use @name capture for symbol name and @definition.X captures for kind. */
  readonly symbolQuery: string;
};

export type TreeSitterHooks = {
  /** Override name extraction for a matched node. Default: @name capture text */
  readonly extractName?: (
    node: Parser.SyntaxNode,
    captures: Parser.QueryCapture[],
  ) => string | null;
  /** Override export detection. Default: () => true */
  readonly isExported?: (node: Parser.SyntaxNode) => boolean;
};

// ── Parser cache ──

type CachedParser = {
  readonly parser: Parser;
  readonly query: Parser.Query;
};

const parserCache = new Map<string, CachedParser>();
let treeSitterInitialized = false;

/** Initialize a tree-sitter parser for the given grammar. Cached per wasmFile. */
export async function initTreeSitterParser(grammar: TreeSitterGrammar): Promise<CachedParser> {
  const cached = parserCache.get(grammar.wasmFile);
  if (cached) return cached;

  const TreeSitter = (await import("web-tree-sitter")).default;
  if (!treeSitterInitialized) {
    await TreeSitter.init();
    treeSitterInitialized = true;
  }

  const wasmPath = resolve(
    import.meta.dir,
    "../../node_modules/tree-sitter-wasms/out",
    grammar.wasmFile,
  );
  const lang = await TreeSitter.Language.load(wasmPath);

  const parser = new TreeSitter();
  parser.setLanguage(lang);

  const query = lang.query(grammar.symbolQuery);

  const entry: CachedParser = { parser, query };
  parserCache.set(grammar.wasmFile, entry);
  return entry;
}

/** Check if a parser for the given grammar is already initialized. */
export function isParserReady(grammar: TreeSitterGrammar): boolean {
  return parserCache.has(grammar.wasmFile);
}

// ── Symbol extraction ──

const DEFINITION_PREFIX = "definition.";

/** Extract symbols from source using tree-sitter query matches. */
export function extractSymbols(
  parser: Parser,
  query: Parser.Query,
  source: string,
  _filename: string,
  hooks?: TreeSitterHooks,
): OxcSymbol[] {
  if (source.length === 0) return [];

  const tree = parser.parse(source);
  const matches = query.matches(tree.rootNode);
  const symbols: OxcSymbol[] = [];

  for (const match of matches) {
    // Find the @definition.X capture for kind
    let kind: string | undefined;
    let defNode: Parser.SyntaxNode | undefined;
    let nameText: string | null = null;

    for (const capture of match.captures) {
      if (capture.name.startsWith(DEFINITION_PREFIX)) {
        kind = capture.name.slice(DEFINITION_PREFIX.length);
        defNode = capture.node;
      } else if (capture.name === "name") {
        nameText = capture.node.text;
      }
    }

    if (!kind || !defNode) continue;

    // Only include top-level symbols (direct children of the root node).
    // web-tree-sitter nodes don't support identity (===) comparison — use id.
    if (defNode.parent?.id !== tree.rootNode.id) continue;

    // Apply hooks or use defaults
    const name = hooks?.extractName ? hooks.extractName(defNode, match.captures) : nameText;

    if (!name) continue;

    const exported = hooks?.isExported ? hooks.isExported(defNode) : true;

    symbols.push({
      name,
      kind,
      exported,
      line: defNode.startPosition.row + 1,
      range: { start: defNode.startIndex, end: defNode.endIndex },
    });
  }

  return symbols;
}

// ── Validation ──

/** Validate syntax. Returns null if valid, error message if invalid. */
export function validateTreeSitterSyntax(
  parser: Parser,
  grammar: TreeSitterGrammar,
  source: string,
): string | null {
  if (source.length === 0) return null;
  const tree = parser.parse(source);
  if (tree.rootNode.hasError) return `${grammar.language} syntax error detected`;
  return null;
}

// ── Plugin factory ──

/**
 * Create an AstPlugin from a tree-sitter grammar config.
 *
 * Tier 1: grammar only (PHP, Go, Python) — no hooks needed.
 * Tier 2: grammar + hooks (Rust) — custom name extraction or export detection.
 */
export async function makeTreeSitterPlugin(
  extensions: ReadonlySet<string>,
  grammar: TreeSitterGrammar,
  hooks?: TreeSitterHooks,
): Promise<AstPlugin["Type"]> {
  const { parser, query } = await initTreeSitterParser(grammar);

  return {
    extensions,
    parseSymbols: (source, path) => extractSymbols(parser, query, source, path, hooks),
    locateSymbol: (source, name, path) => {
      const symbols = extractSymbols(parser, query, source, path, hooks);
      const match = symbols.find((s) => s.name === name);
      return Option.fromNullable(match ? (match.range as SymbolRange) : null);
    },
    validateSyntax: (source, _path) =>
      Option.fromNullable(validateTreeSitterSyntax(parser, grammar, source)),
  };
}
