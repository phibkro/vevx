/**
 * Pure module that parses `.d.ts` content and extracts type references
 * for BFS traversal of the type dependency graph.
 *
 * No I/O, no node:fs, no Effect. Just string parsing.
 */

const BUILTIN_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "void",
  "undefined",
  "null",
  "never",
  "any",
  "unknown",
  "object",
  "bigint",
  "symbol",
  "Array",
  "Promise",
  "Record",
  "Map",
  "Set",
  "WeakMap",
  "WeakSet",
  "ReadonlyArray",
  "Readonly",
  "Partial",
  "Required",
  "Pick",
  "Omit",
  "Exclude",
  "Extract",
  "NonNullable",
  "ReturnType",
  "Parameters",
  "InstanceType",
  "ConstructorParameters",
  "Awaited",
  "Function",
  "Date",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
]);

/**
 * Parse all `import type { ... } from "..."` and `import { type ..., type ... } from "..."`
 * statements and return a map from imported type name to the set of specifiers they came from.
 */
function parseTypeImports(dts: string): Map<string, string> {
  const result = new Map<string, string>();

  // Match `import type { Foo, Bar } from "./source.js"`
  const importTypeRe = /import\s+type\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importTypeRe.exec(dts)) !== null) {
    const names = m[1];
    const source = m[2];
    for (const raw of names.split(",")) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      // Handle `Foo as Bar` — use the local alias (Bar) as the key
      const asMatch = /^(\w+)\s+as\s+(\w+)$/.exec(trimmed);
      result.set(asMatch ? asMatch[2] : trimmed, source);
    }
  }

  // Match `import { type Foo, type Bar } from "./source.js"`
  const importMixedRe = /import\s*\{([^}]+)\}\s*from\s*["']([^"']+)["']/g;
  while ((m = importMixedRe.exec(dts)) !== null) {
    const names = m[1];
    const source = m[2];
    for (const raw of names.split(",")) {
      const trimmed = raw.trim();
      const typeMatch = /^type\s+(\w+)/.exec(trimmed);
      if (typeMatch) {
        result.set(typeMatch[1], source);
      }
    }
  }

  return result;
}

/**
 * Collect all type-looking identifiers (uppercase-starting) from non-import lines.
 */
function collectAllTypeIdents(dts: string): Set<string> {
  const refs = new Set<string>();
  const re = /\b([A-Z][A-Za-z0-9_]*)\b/g;
  const lines = dts.split("\n");
  for (const line of lines) {
    // Skip import lines — we parse those separately
    if (/^\s*import\s/.test(line)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line)) !== null) {
      const name = m[1];
      if (!BUILTIN_TYPES.has(name)) {
        refs.add(name);
      }
    }
  }
  return refs;
}

/**
 * Extract non-builtin type references from `.d.ts` content.
 *
 * - **Shallow mode** (`deep=false`): Only return types that appear in import
 *   statements AND are referenced in signatures. These are the cross-file
 *   references to follow during BFS.
 * - **Deep mode** (`deep=true`): Also include generic constraints, conditional
 *   types, and any other non-builtin type identifier found in signatures.
 */
export function extractTypeReferences(dts: string, deep: boolean): string[] {
  const imports = parseTypeImports(dts);
  const bodyRefs = collectAllTypeIdents(dts);

  if (deep) {
    // Deep: return all non-builtin type references found in signatures
    return [...bodyRefs];
  }

  // Shallow: only imported types that are also referenced in body
  const result: string[] = [];
  for (const name of imports.keys()) {
    if (bodyRefs.has(name)) {
      result.push(name);
    }
  }
  return result;
}

/**
 * Map type names to their import source specifiers by parsing
 * `import type { Foo } from "./bar.js"` statements.
 */
export function resolveTypeOrigins(dts: string): Map<string, string> {
  return parseTypeImports(dts);
}
