import { findOwningComponent, buildComponentPaths } from "#shared/ownership.js";
import type { Manifest, Touches, ImportDep } from "#shared/types.js";

/**
 * Suggest touches declaration from file paths and import dependencies.
 * Pure function — no I/O.
 */
export function suggestTouches(
  filePaths: string[],
  manifest: Manifest,
  importDeps: ImportDep[],
  coChangeDeps?: ImportDep[],
): Touches {
  const componentPaths = buildComponentPaths(manifest);

  // Files → write components
  const writes = new Set<string>();
  for (const filePath of filePaths) {
    const owner = findOwningComponent(filePath, manifest, componentPaths);
    if (owner) writes.add(owner);
  }

  // Import deps + co-change deps → read components
  const allDeps = coChangeDeps ? [...importDeps, ...coChangeDeps] : importDeps;
  const reads = new Set<string>();
  for (const dep of allDeps) {
    if (writes.has(dep.from) && !writes.has(dep.to)) {
      reads.add(dep.to);
    }
  }

  return {
    writes: writes.size > 0 ? [...writes].sort() : undefined,
    reads: reads.size > 0 ? [...reads].sort() : undefined,
  };
}
