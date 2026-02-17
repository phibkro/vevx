import { basename } from "node:path";
import type { Manifest, Touches, ResolvedDocs } from "../types.js";
import { discoverDocs } from "./discovery.js";

export function resolveDocs(manifest: Manifest, touches: Touches): ResolvedDocs {
  const docs: { component: string; doc: string; path: string }[] = [];
  const seen = new Set<string>();

  const readSet = new Set(touches.reads ?? []);
  const writeSet = new Set(touches.writes ?? []);
  const allComponents = new Set([...readSet, ...writeSet]);

  for (const name of allComponents) {
    const component = manifest.components[name];
    if (!component) {
      throw new Error(`Unknown component: ${name}`);
    }

    const isWrite = writeSet.has(name);
    const docPaths = discoverDocs(component);

    for (const docPath of docPaths) {
      const isPublic = basename(docPath) === "README.md";

      // Public docs (README.md) load for reads AND writes
      // Private docs load for writes only
      const shouldLoad = isPublic || isWrite;

      if (shouldLoad && !seen.has(docPath)) {
        seen.add(docPath);
        const docName = basename(docPath, ".md");
        docs.push({ component: name, doc: docName, path: docPath });
      }
    }
  }

  return { docs };
}
