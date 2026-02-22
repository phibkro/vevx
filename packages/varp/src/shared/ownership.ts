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

/**
 * Resolve an array of component references (names or tags) to component names.
 * Component names take priority over tags. Throws on unknown references.
 */
export function resolveComponentRefs(manifest: Manifest, refs: string[]): string[] {
  const tagMap = new Map<string, string[]>();
  for (const [name, comp] of Object.entries(manifest.components)) {
    for (const tag of comp.tags ?? []) {
      const list = tagMap.get(tag) ?? [];
      list.push(name);
      tagMap.set(tag, list);
    }
  }

  const componentNames = new Set(Object.keys(manifest.components));
  const resolved = new Set<string>();

  for (const ref of refs) {
    if (componentNames.has(ref)) {
      resolved.add(ref);
    } else if (tagMap.has(ref)) {
      for (const name of tagMap.get(ref)!) resolved.add(name);
    } else {
      throw new Error(`Unknown component or tag: "${ref}"`);
    }
  }

  return [...resolved];
}
