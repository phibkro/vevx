import { readFileSync, existsSync, readdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";

import { findOwningComponent, buildComponentPaths } from "#shared/ownership.js";
import {
  componentPaths,
  type Manifest,
  type ImportScanResult,
  type ImportDep,
} from "#shared/types.js";

// ── Pure types ──

interface RawImport {
  specifier: string;
}

export type SourceFile = { path: string; component: string; content: string };

export interface PathMapping {
  pattern: string;
  targets: string[];
}

export interface PathAliases {
  mappings: PathMapping[];
  baseDir: string;
}

// ── Pure functions ──

/**
 * Strip JSON comments (// and block comments) for tsconfig parsing.
 */
function stripJsonComments(text: string): string {
  return text.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

interface TsconfigCompilerOptions {
  paths?: Record<string, string[]>;
  baseUrl?: string;
}

interface TsconfigRaw {
  extends?: string;
  compilerOptions?: TsconfigCompilerOptions;
}

/**
 * Read and parse a single tsconfig file. Returns null on read/parse failure.
 */
function readTsconfig(filePath: string): TsconfigRaw | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
}

/**
 * Resolve a tsconfig `extends` specifier to an absolute path.
 * Supports relative paths and bare package names (resolved via node_modules).
 */
function resolveExtendsPath(specifier: string, fromDir: string): string | null {
  // Relative path
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = resolve(fromDir, specifier);
    // Add .json if missing
    if (!resolved.endsWith(".json")) {
      if (existsSync(resolved + ".json")) return resolved + ".json";
      // Try as-is (could be a directory with tsconfig.json inside, but uncommon)
      if (existsSync(resolved)) return resolved;
      return resolved + ".json";
    }
    return resolved;
  }

  // Bare specifier — look in node_modules
  // Try: node_modules/<specifier>, node_modules/<specifier>.json,
  //       node_modules/<specifier>/tsconfig.json
  const nmBase = join(fromDir, "node_modules", specifier);
  if (existsSync(nmBase) && !nmBase.endsWith(".json")) {
    // Could be a directory — try tsconfig.json inside
    const inner = join(nmBase, "tsconfig.json");
    if (existsSync(inner)) return inner;
  }
  if (existsSync(nmBase)) return nmBase;
  if (!nmBase.endsWith(".json") && existsSync(nmBase + ".json")) return nmBase + ".json";

  return null;
}

/**
 * Recursively resolve tsconfig compilerOptions, following `extends` chains.
 * Parent options are overridden by child options. Paths are merged key-by-key.
 */
function resolveTsconfigOptions(
  filePath: string,
  visited: Set<string>,
): TsconfigCompilerOptions | null {
  const abs = resolve(filePath);
  if (visited.has(abs)) return null; // cycle
  visited.add(abs);

  const parsed = readTsconfig(abs);
  if (!parsed) return null;

  let parentOptions: TsconfigCompilerOptions = {};
  if (parsed.extends) {
    const parentPath = resolveExtendsPath(parsed.extends, dirname(abs));
    if (parentPath) {
      parentOptions = resolveTsconfigOptions(parentPath, visited) ?? {};
    }
  }

  // Merge: child overrides parent. Paths are merged key-by-key.
  const mergedPaths = { ...parentOptions.paths, ...parsed.compilerOptions?.paths };
  return {
    baseUrl: parsed.compilerOptions?.baseUrl ?? parentOptions.baseUrl,
    paths: Object.keys(mergedPaths).length > 0 ? mergedPaths : undefined,
  };
}

/**
 * Load tsconfig.json `compilerOptions.paths` from a directory.
 * Follows `extends` chains to inherit paths from parent configs.
 * Returns null if tsconfig.json doesn't exist or has no paths.
 */
export function loadTsconfigPaths(dir: string): PathAliases | null {
  const tsconfigPath = join(dir, "tsconfig.json");
  const options = resolveTsconfigOptions(tsconfigPath, new Set());
  if (!options) return null;

  const paths = options.paths;
  if (!paths || Object.keys(paths).length === 0) return null;

  const baseUrl = options.baseUrl ?? ".";
  const baseDir = resolve(dir, baseUrl);

  const mappings: PathMapping[] = Object.entries(paths).map(([pattern, targets]) => ({
    pattern,
    targets,
  }));

  return { mappings, baseDir };
}

/**
 * Compute alias prefixes from path mappings for use in extractImports.
 * Wildcard `#shared/*` → prefix `#shared/`, exact `#shared` → prefix `#shared`.
 */
export function aliasPrefixesFrom(aliases: PathAliases): string[] {
  return aliases.mappings.map((m) =>
    m.pattern.endsWith("/*") ? m.pattern.slice(0, -1) : m.pattern,
  );
}

/**
 * Resolve a path alias specifier to an absolute path.
 * Returns null if the specifier doesn't match any alias pattern.
 */
export function resolveAlias(specifier: string, aliases: PathAliases): string | null {
  for (const mapping of aliases.mappings) {
    if (mapping.pattern.endsWith("/*")) {
      // Wildcard: #shared/* matches #shared/types.js
      const prefix = mapping.pattern.slice(0, -1); // "#shared/"
      if (specifier.startsWith(prefix)) {
        const rest = specifier.slice(prefix.length);
        const target = mapping.targets[0];
        if (!target) continue;
        const targetBase = target.endsWith("/*") ? target.slice(0, -1) : target;
        return resolve(aliases.baseDir, targetBase + rest);
      }
    } else {
      // Exact match
      if (specifier === mapping.pattern) {
        const target = mapping.targets[0];
        if (!target) continue;
        return resolve(aliases.baseDir, target);
      }
    }
  }
  return null;
}

/**
 * Extract static import/export specifiers from source content.
 * Skips bare specifiers (external packages) and dynamic imports.
 * When aliasPrefixes is provided, also captures specifiers matching those prefixes.
 */
export function extractImports(content: string, aliasPrefixes?: string[]): RawImport[] {
  // Match static import/export-from statements with relative specifiers
  // Forms: import { x } from '...', import x from '...', import * as x from '...',
  //        import type { x } from '...', export { x } from '...', export * from '...'
  const regex =
    /(?:import|export)\s+(?:type\s+)?(?:\*\s+as\s+\w+|{[^}]*}|\w+)\s+from\s+['"]([^'"]+)['"]|(?:export)\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  const imports: RawImport[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const specifier = match[1] ?? match[2];
    // Accept relative specifiers
    if (specifier.startsWith("./") || specifier.startsWith("../")) {
      imports.push({ specifier });
      continue;
    }
    // Accept alias-prefixed specifiers
    if (aliasPrefixes?.some((p) => specifier.startsWith(p) || specifier === p)) {
      imports.push({ specifier });
      continue;
    }
    // Skip bare specifiers — external packages
  }

  return imports;
}

/**
 * Resolve an import specifier to an absolute file path.
 * Handles .js→.ts and .jsx→.tsx remapping, and directory→index resolution.
 * When aliases are provided, resolves alias specifiers before file resolution.
 */
export function resolveImport(
  specifier: string,
  sourceFile: string,
  fileExists: (path: string) => boolean,
  aliases?: PathAliases,
): string {
  // Try alias resolution for non-relative specifiers
  let base: string;
  if (aliases && !specifier.startsWith("./") && !specifier.startsWith("../")) {
    const aliased = resolveAlias(specifier, aliases);
    if (aliased) {
      base = aliased;
    } else {
      base = resolve(dirname(sourceFile), specifier);
    }
  } else {
    base = resolve(dirname(sourceFile), specifier);
  }

  // Try .js → .ts remapping
  if (base.endsWith(".js")) {
    const tsPath = base.slice(0, -3) + ".ts";
    if (fileExists(tsPath)) return tsPath;
  }

  // Try .jsx → .tsx remapping
  if (base.endsWith(".jsx")) {
    const tsxPath = base.slice(0, -4) + ".tsx";
    if (fileExists(tsxPath)) return tsxPath;
  }

  // If the base itself exists, use it
  if (fileExists(base)) return base;

  // Try directory → index resolution
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    const indexPath = join(base, `index${ext}`);
    if (fileExists(indexPath)) return indexPath;
  }

  // Fallback: return base as-is
  return base;
}

// ── Pure analysis ──

/**
 * Analyze pre-loaded source files for cross-component import dependencies.
 * Pure function — no I/O, fully testable with synthetic data.
 */
export function analyzeImports(
  files: SourceFile[],
  manifest: Manifest,
  fileExists: (path: string) => boolean,
  aliases?: PathAliases,
): ImportScanResult {
  const componentPaths = buildComponentPaths(manifest);
  const aliasPrefixes = aliases ? aliasPrefixesFrom(aliases) : undefined;
  const inferredDepsMap = new Map<
    string,
    { from: string; to: string; evidence: { source_file: string; import_specifier: string }[] }
  >();
  let totalImportsScanned = 0;

  for (const file of files) {
    const rawImports = extractImports(file.content, aliasPrefixes);

    for (const imp of rawImports) {
      totalImportsScanned++;
      const resolved = resolveImport(imp.specifier, file.path, fileExists, aliases);
      const targetOwner = findOwningComponent(resolved, manifest, componentPaths);

      if (targetOwner !== null && targetOwner !== file.component) {
        const key = `${file.component}->${targetOwner}`;
        const existing = inferredDepsMap.get(key);
        if (existing) {
          existing.evidence.push({
            source_file: file.path,
            import_specifier: imp.specifier,
          });
        } else {
          inferredDepsMap.set(key, {
            from: file.component,
            to: targetOwner,
            evidence: [{ source_file: file.path, import_specifier: imp.specifier }],
          });
        }
      }
    }
  }

  const import_deps: ImportDep[] = Array.from(inferredDepsMap.values());

  // Compare inferred deps against declared deps
  const declaredDepsSet = new Set<string>();
  for (const [compName, comp] of Object.entries(manifest.components)) {
    for (const dep of comp.deps ?? []) {
      declaredDepsSet.add(`${compName}->${dep}`);
    }
  }

  const inferredKeys = new Set(inferredDepsMap.keys());
  const missing_deps = import_deps.filter((d) => !declaredDepsSet.has(`${d.from}->${d.to}`));
  const extra_deps: { from: string; to: string }[] = [];
  for (const declared of declaredDepsSet) {
    if (!inferredKeys.has(declared)) {
      const [from, to] = declared.split("->");
      extra_deps.push({ from, to });
    }
  }

  // Track which components had source files
  const componentsWithSource = new Set<string>();
  for (const file of files) {
    componentsWithSource.add(file.component);
  }

  return {
    import_deps,
    missing_deps,
    extra_deps,
    total_files_scanned: files.length,
    total_imports_scanned: totalImportsScanned,
    components_with_source: Array.from(componentsWithSource),
  };
}

// ── Effectful wrapper ──

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);
const SKIP_DIRS = new Set(["node_modules", "build"]);

function isSourceFile(name: string): boolean {
  for (const ext of SOURCE_EXTENSIONS) {
    if (name.endsWith(ext)) {
      // Skip test files
      if (name.endsWith(".test.ts") || name.endsWith(".test.tsx")) return false;
      return true;
    }
  }
  return false;
}

/**
 * Scan all component source files for import statements.
 * Loads files from disk, then delegates to pure analyzeImports().
 * Automatically loads tsconfig.json paths from the manifest directory.
 */
export function scanImports(manifest: Manifest, manifestDir?: string): ImportScanResult {
  // Load tsconfig path aliases from manifest directory
  const aliases = manifestDir ? loadTsconfigPaths(manifestDir) : null;

  const files: SourceFile[] = [];

  for (const [compName, comp] of Object.entries(manifest.components)) {
    for (const compPath of componentPaths(comp)) {
      try {
        const entries = readdirSync(compPath, { withFileTypes: true, recursive: true });
        for (const entry of entries) {
          if (!entry.isFile()) continue;
          if (!isSourceFile(entry.name)) continue;

          const parentPath = (entry as any).parentPath ?? compPath;
          const fullPath = join(parentPath, entry.name);

          // Skip files inside excluded directories
          const relFromComp = fullPath.slice(compPath.length + 1);
          const parts = relFromComp.split("/");
          if (parts.some((p) => SKIP_DIRS.has(p))) continue;

          try {
            const content = readFileSync(fullPath, "utf-8");
            files.push({ path: fullPath, component: compName, content });
          } catch {
            /* skip unreadable files */
          }
        }
      } catch {
        /* skip components whose path doesn't exist */
      }
    }
  }

  return analyzeImports(files, manifest, existsSync, aliases ?? undefined);
}
