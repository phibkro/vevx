import { resolve, relative } from "path";

import type { FileContent } from "../agents/types";

/**
 * Get list of changed files from git diff.
 * Returns relative paths from the target directory.
 *
 * @param targetPath - Directory to run git diff in
 * @param ref - Git ref to diff against (default: HEAD)
 */
export function getChangedFiles(targetPath: string, ref: string = "HEAD"): string[] {
  const cwd = resolve(targetPath);

  try {
    const proc = Bun.spawnSync(["git", "diff", "--name-only", ref], {
      cwd,
      stdout: "pipe",
      stderr: "ignore",
      timeout: 10_000,
    });

    if (!proc.success) return [];

    const output = proc.stdout.toString("utf-8").trim();
    if (!output) return [];

    return output.split("\n").filter(Boolean);
  } catch {
    // Not a git repo or git not available
    return [];
  }
}

/**
 * Filter discovered files to only those that changed in the diff.
 */
export function filterToChanged(files: FileContent[], changedPaths: string[]): FileContent[] {
  const changedSet = new Set(changedPaths);
  return files.filter((f) => changedSet.has(f.relativePath));
}

/**
 * Expand changed file paths to include files in dependent components.
 * Uses the manifest's dependency graph to find downstream components
 * whose inputs may have been affected by changes.
 *
 * @param changedPaths - Files that changed
 * @param components - Manifest component definitions with deps
 * @param componentFileMap - Map of component name → file paths
 * @returns Expanded list of file paths (original + dependents)
 */
export function expandWithDependents(
  changedPaths: string[],
  components: Record<string, { path: string | string[]; deps?: string[] }>,
  componentFileMap: Map<string, string[]>,
): string[] {
  // Find which components contain changed files
  const changedComponents = new Set<string>();

  for (const [name, comp] of Object.entries(components)) {
    const compPaths = Array.isArray(comp.path) ? comp.path : [comp.path];
    for (const changed of changedPaths) {
      if (
        compPaths.some((cp) => {
          const rel = relative(cp, resolve(cp, "..", changed));
          return !rel.startsWith("..");
        })
      ) {
        changedComponents.add(name);
      }
    }
  }

  if (changedComponents.size === 0) return changedPaths;

  // Build reverse dependency map
  const reverseDeps = new Map<string, string[]>();
  for (const name of Object.keys(components)) {
    reverseDeps.set(name, []);
  }
  for (const [name, comp] of Object.entries(components)) {
    for (const dep of comp.deps ?? []) {
      const list = reverseDeps.get(dep);
      if (list) list.push(name);
    }
  }

  // BFS from changed components to find all affected
  const affected = new Set<string>();
  const queue = [...changedComponents];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (affected.has(current)) continue;
    affected.add(current);

    for (const dep of reverseDeps.get(current) ?? []) {
      if (!affected.has(dep)) queue.push(dep);
    }
  }

  // Collect all file paths from affected components
  const expandedPaths = new Set(changedPaths);
  for (const compName of affected) {
    const files = componentFileMap.get(compName) ?? [];
    for (const f of files) expandedPaths.add(f);
  }

  return [...expandedPaths];
}
