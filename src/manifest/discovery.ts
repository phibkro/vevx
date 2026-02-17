import { join } from "node:path";
import { existsSync, readdirSync } from "node:fs";

/**
 * Returns all doc paths for a component: explicit + auto-discovered.
 *
 * Auto-discovery:
 * - {component.path}/README.md → public doc (if exists, not already listed)
 * - {component.path}/docs/*.md → private docs (if dir exists, not already listed)
 */
export function discoverDocs(component: { path: string; docs: string[] }): string[] {
  const docPaths = [...component.docs];

  // Auto-discover README.md at component root
  const readmePath = join(component.path, "README.md");
  if (existsSync(readmePath) && !docPaths.includes(readmePath)) {
    docPaths.push(readmePath);
  }

  // Auto-discover docs/*.md within component path
  const docsDir = join(component.path, "docs");
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

  return docPaths;
}
