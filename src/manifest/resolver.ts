import type { Manifest, Touches, ResolvedDocs } from "../types.js";

export function resolveDocs(manifest: Manifest, touches: Touches): ResolvedDocs {
  const docs: { component: string; doc_name: string; path: string }[] = [];
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

    for (const doc of component.docs) {
      // "reads" docs load for both reads and writes
      // "writes" docs load only for writes
      const shouldLoad = doc.load_on.includes("reads") || (isWrite && doc.load_on.includes("writes"));
      if (shouldLoad) {
        const key = `${name}:${doc.name}`;
        if (!seen.has(key)) {
          seen.add(key);
          docs.push({ component: name, doc_name: doc.name, path: doc.path });
        }
      }
    }
  }

  return { docs };
}
