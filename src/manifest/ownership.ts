import { resolve, relative } from "node:path";
import type { Manifest } from "../types.js";

/**
 * Build a sorted list of component paths for ownership lookup.
 * Sorted by descending path length so longer (more specific) paths match first.
 */
function buildComponentPaths(manifest: Manifest) {
  return Object.entries(manifest.components)
    .map(([name, comp]) => ({
      name,
      path: resolve(comp.path),
    }))
    .sort((a, b) => b.path.length - a.path.length);
}

/**
 * Find which component owns a given file path via longest-prefix match.
 * Returns the component name, or null if the file is outside all components.
 */
export function findOwningComponent(
  filePath: string,
  manifest: Manifest,
): string | null {
  const absPath = resolve(filePath);
  const componentPaths = buildComponentPaths(manifest);

  for (const { name, path } of componentPaths) {
    const rel = relative(path, absPath);
    if (!rel.startsWith("..") && !rel.startsWith("/")) {
      return name;
    }
  }

  return null;
}
