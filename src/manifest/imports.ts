import { resolve, dirname, join } from "node:path";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import type { Manifest, ImportScanResult, ImportDep } from "../types.js";
import { findOwningComponent, buildComponentPaths } from "../ownership.js";

// ── Pure types ──

interface RawImport {
  specifier: string;
}

export type SourceFile = { path: string; component: string; content: string };

// ── Pure functions ──

/**
 * Extract static import/export-from specifiers from source content.
 * Skips bare specifiers (external packages) and dynamic imports.
 */
export function extractImports(content: string): RawImport[] {
  // Match static import/export-from statements with relative specifiers
  // Forms: import { x } from '...', import x from '...', import * as x from '...',
  //        import type { x } from '...', export { x } from '...', export * from '...'
  const regex =
    /(?:import|export)\s+(?:type\s+)?(?:\*\s+as\s+\w+|{[^}]*}|\w+)\s+from\s+['"]([^'"]+)['"]|(?:export)\s+\*\s+from\s+['"]([^'"]+)['"]/g;
  const imports: RawImport[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const specifier = match[1] ?? match[2];
    // Skip bare specifiers (no ./ or ../ prefix) — external packages
    if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
      continue;
    }
    imports.push({ specifier });
  }

  return imports;
}

/**
 * Resolve a relative import specifier to an absolute file path.
 * Handles .js→.ts and .jsx→.tsx remapping, and directory→index resolution.
 * Accepts a fileExists predicate for testability.
 */
export function resolveImport(
  specifier: string,
  sourceFile: string,
  fileExists: (path: string) => boolean,
): string {
  const base = resolve(dirname(sourceFile), specifier);

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
): ImportScanResult {
  const componentPaths = buildComponentPaths(manifest);
  const inferredDepsMap = new Map<
    string,
    { from: string; to: string; evidence: { source_file: string; import_specifier: string }[] }
  >();
  let totalImportsScanned = 0;

  for (const file of files) {
    const rawImports = extractImports(file.content);

    for (const imp of rawImports) {
      totalImportsScanned++;
      const resolved = resolveImport(imp.specifier, file.path, fileExists);
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

  return {
    import_deps,
    missing_deps,
    extra_deps,
    total_files_scanned: files.length,
    total_imports_scanned: totalImportsScanned,
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
 */
export function scanImports(manifest: Manifest): ImportScanResult {
  const files: SourceFile[] = [];

  for (const [compName, comp] of Object.entries(manifest.components)) {
    try {
      const entries = readdirSync(comp.path, { withFileTypes: true, recursive: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        if (!isSourceFile(entry.name)) continue;

        const parentPath = (entry as any).parentPath ?? comp.path;
        const fullPath = join(parentPath, entry.name);

        // Skip files inside excluded directories
        const relFromComp = fullPath.slice(comp.path.length + 1);
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

  return analyzeImports(files, manifest, existsSync);
}
