import type { Manifest, Touches, ImportDep } from "../types.js";
import { findOwningComponent, buildComponentPaths } from "../ownership.js";

/**
 * Suggest touches declaration from file paths and import dependencies.
 * Pure function — no I/O.
 */
export function suggestTouches(
  filePaths: string[],
  manifest: Manifest,
  importDeps: ImportDep[],
): Touches {
  const componentPaths = buildComponentPaths(manifest);

  // Files → write components
  const writes = new Set<string>();
  for (const filePath of filePaths) {
    const owner = findOwningComponent(filePath, manifest, componentPaths);
    if (owner) writes.add(owner);
  }

  // Import deps → read components
  const reads = new Set<string>();
  for (const dep of importDeps) {
    if (writes.has(dep.from) && !writes.has(dep.to)) {
      reads.add(dep.to);
    }
  }

  return {
    writes: writes.size > 0 ? [...writes].sort() : undefined,
    reads: reads.size > 0 ? [...reads].sort() : undefined,
  };
}
