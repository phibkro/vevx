import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { componentPaths, type Component } from "#shared/types.js";

/**
 * Returns all doc paths for a component: explicit + auto-discovered.
 *
 * Auto-discovery (for each component path):
 * - {path}/README.md → public doc (if exists, not already listed)
 * - {path}/docs/*.md → private docs (if dir exists, not already listed)
 */
export function discoverDocs(component: Pick<Component, "path" | "docs">): string[] {
  const docPaths = [...component.docs];

  for (const compPath of componentPaths(component as Component)) {
    // Auto-discover README.md at component root
    const readmePath = join(compPath, "README.md");
    if (existsSync(readmePath) && !docPaths.includes(readmePath)) {
      docPaths.push(readmePath);
    }

    // Auto-discover docs/*.md within component path
    const docsDir = join(compPath, "docs");
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

  return docPaths;
}
