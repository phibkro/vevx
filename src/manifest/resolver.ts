import type { Manifest, Touches, ResolvedDocs } from "../types.js";

export function resolveDocs(manifest: Manifest, touches: Touches): ResolvedDocs {
  const interface_docs: { component: string; path: string }[] = [];
  const internal_docs: { component: string; path: string }[] = [];

  const allComponents = new Set([
    ...(touches.reads ?? []),
    ...(touches.writes ?? []),
  ]);

  for (const name of allComponents) {
    const component = manifest.components[name];
    if (!component) {
      throw new Error(`Unknown component: ${name}`);
    }
    interface_docs.push({ component: name, path: component.docs.interface });
  }

  for (const name of touches.writes ?? []) {
    const component = manifest.components[name];
    if (!component) {
      throw new Error(`Unknown component: ${name}`);
    }
    internal_docs.push({ component: name, path: component.docs.internal });
  }

  return { interface_docs, internal_docs };
}
