import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";

import { componentPaths, type Component } from "#shared/types.js";

/**
 * Build discovery roots for a component path. The `src/` directory is
 * transparent — it collapses with its parent in both directions:
 *
 * - `path: foo/src` → also scan `foo/`
 * - `path: foo`     → also scan `foo/src/`
 */
function discoveryRoots(compPath: string): string[] {
  const roots = [compPath];
  if (basename(compPath) === "src") {
    roots.push(dirname(compPath));
  } else {
    const srcChild = join(compPath, "src");
    if (existsSync(srcChild)) {
      roots.push(srcChild);
    }
  }
  return roots;
}

/**
 * Returns all doc paths for a component: explicit + auto-discovered.
 *
 * Auto-discovery (for each component path + src-collapsed roots):
 * - {root}/README.md → public doc (if exists, not already listed)
 * - {root}/docs/*.md → private docs (if dir exists, not already listed)
 */
export function discoverDocs(component: Pick<Component, "path" | "docs">): string[] {
  const docPaths = [...component.docs];

  for (const compPath of componentPaths(component as Component)) {
    for (const root of discoveryRoots(compPath)) {
      // Auto-discover README.md at root
      const readmePath = join(root, "README.md");
      if (existsSync(readmePath) && !docPaths.includes(readmePath)) {
        docPaths.push(readmePath);
      }

      // Auto-discover docs/*.md within root
      const docsDir = join(root, "docs");
      if (existsSync(docsDir)) {
        try {
          const entries = readdirSync(docsDir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith(".md")) {
              const fullPath = join(docsDir, entry.name);
              if (!docPaths.includes(fullPath)) {
                docPaths.push(fullPath);
              }
            }
          }
        } catch {
          /* skip unreadable dirs */
        }
      }
    }
  }

  return docPaths;
}
