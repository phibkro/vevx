import { resolve, relative } from "node:path";

import { componentPaths, type Manifest } from "./types.js";

export type ComponentPathEntry = { name: string; path: string };

/**
 * Build a sorted list of component paths for ownership lookup.
 * Sorted by descending path length so longer (more specific) paths match first.
 * Call once and pass the result to findOwningComponent for batch lookups.
 * Multi-path components emit one entry per path.
 */
export function buildComponentPaths(manifest: Manifest): ComponentPathEntry[] {
  return Object.entries(manifest.components)
    .flatMap(([name, comp]) =>
      componentPaths(comp).map((p) => ({
        name,
        path: resolve(p),
      })),
    )
    .sort((a, b) => b.path.length - a.path.length);
}

/**
 * Find which component owns a given file path via longest-prefix match.
 * Returns the component name, or null if the file is outside all components.
 *
 * Pass pre-built componentPaths for batch lookups to avoid rebuilding per call.
 */
export function findOwningComponent(
  filePath: string,
  manifest: Manifest,
  componentPaths?: ComponentPathEntry[],
): string | null {
  const absPath = resolve(filePath);
  const paths = componentPaths ?? buildComponentPaths(manifest);

  for (const { name, path } of paths) {
    const rel = relative(path, absPath);
    if (!rel.startsWith("..") && !rel.startsWith("/")) {
      return name;
    }
  }

  return null;
}
