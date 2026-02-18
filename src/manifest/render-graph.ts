import type { Manifest } from "#shared/types.js";

const STABILITY_BADGES: Record<string, string> = {
  stable: "🟢",
  active: "🟡",
  experimental: "🔴",
};

/**
 * Render the manifest dependency graph as Mermaid diagram syntax.
 */
export function renderGraph(manifest: Manifest, opts?: { direction?: "TD" | "LR" }): string {
  const direction = opts?.direction ?? "TD";
  const lines: string[] = [`graph ${direction}`];

  const components = Object.entries(manifest.components);

  // Node declarations with optional stability badge
  for (const [name, comp] of components) {
    const badge = comp.stability ? ` ${STABILITY_BADGES[comp.stability] ?? ""}` : "";
    if (badge) {
      lines.push(`  ${name}["${name}${badge}"]`);
    } else {
      lines.push(`  ${name}`);
    }
  }

  // Dependency edges
  for (const [name, comp] of components) {
    for (const dep of comp.deps ?? []) {
      lines.push(`  ${dep} --> ${name}`);
    }
  }

  return lines.join("\n");
}
