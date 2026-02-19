import type { Manifest } from "#shared/types.js";

const STABILITY_BADGES: Record<string, string> = {
  stable: "🟢",
  active: "🟡",
  experimental: "🔴",
};

const ASCII_STABILITY_BADGES: Record<string, string> = {
  stable: "·",
  active: "·▲",
  experimental: "·⚠",
};

// 8 distinct ANSI colors for tag dots (avoid red/green to help colorblind users)
const TAG_COLORS = [
  "\x1b[34m", // blue
  "\x1b[35m", // magenta
  "\x1b[33m", // yellow
  "\x1b[36m", // cyan
  "\x1b[94m", // bright blue
  "\x1b[95m", // bright magenta
  "\x1b[93m", // bright yellow
  "\x1b[96m", // bright cyan
];
const RESET = "\x1b[0m";

const SUPERSCRIPTS = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

export type AsciiGraphOptions = {
  /** Tag display mode. Default: "color". Set false to hide. */
  tags?: "color" | "superscript" | false;
  /** Show stability badges. Default: true. */
  stability?: boolean;
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

/**
 * Build a sorted tag→index map from a manifest. Only includes tags that appear on at least one component.
 */
function buildTagIndex(manifest: Manifest): Map<string, number> {
  const tagSet = new Set<string>();
  for (const comp of Object.values(manifest.components)) {
    for (const tag of comp.tags ?? []) tagSet.add(tag);
  }
  const sorted = [...tagSet].sort();
  return new Map(sorted.map((t, i) => [t, i]));
}

/**
 * Render tag markers for a component's tags.
 * In "color" mode: colored dots (●). In "superscript" mode: numbered superscripts (¹²³).
 */
function renderTagMarkers(
  tags: string[],
  tagIndex: Map<string, number>,
  mode: "color" | "superscript",
): string {
  if (tags.length === 0) return "";
  const markers = tags
    .map((t) => tagIndex.get(t))
    .filter((i): i is number => i !== undefined)
    .sort((a, b) => a - b)
    .map((i) => {
      if (mode === "color") {
        const color = TAG_COLORS[i % TAG_COLORS.length];
        return `${color}●${RESET}`;
      }
      return SUPERSCRIPTS[i % SUPERSCRIPTS.length];
    });
  return markers.join("");
}

/**
 * Render the tag legend line.
 */
function renderTagLegend(tagIndex: Map<string, number>, mode: "color" | "superscript"): string {
  const entries: string[] = [];
  for (const [tag, i] of tagIndex) {
    if (mode === "color") {
      const color = TAG_COLORS[i % TAG_COLORS.length];
      entries.push(`${color}●${RESET} ${tag}`);
    } else {
      entries.push(`${SUPERSCRIPTS[i % SUPERSCRIPTS.length]} ${tag}`);
    }
  }
  return entries.join("  ");
}

/**
 * Render the manifest dependency graph as ASCII text for terminal display.
 * Uses layered DAG layout: topological sort into depth layers, then tree-like DFS render.
 * Nodes with multiple parents are shown under the first parent with a reference line for others.
 *
 * Tag display modes:
 * - "color" (default): colored dots per tag with legend
 * - "superscript": numbered superscripts per tag with legend (for non-TTY)
 * - false: no tags shown
 */
export function renderAsciiGraph(manifest: Manifest, opts?: AsciiGraphOptions): string {
  const components = manifest.components;
  const names = Object.keys(components);
  if (names.length === 0) return "";

  const tagMode = opts?.tags ?? "color";
  const showStability = opts?.stability !== false;
  const tagIndex = tagMode ? buildTagIndex(manifest) : new Map<string, number>();
  const hasTags = tagMode && tagIndex.size > 0;

  // Build reverse graph: parent → children (component → dependents)
  const children = new Map<string, string[]>();
  const parents = new Map<string, string[]>();
  for (const name of names) {
    children.set(name, []);
    parents.set(name, []);
  }
  for (const [name, comp] of Object.entries(components)) {
    for (const dep of comp.deps ?? []) {
      if (children.has(dep)) {
        children.get(dep)!.push(name);
      }
      parents.get(name)!.push(dep);
    }
  }

  // Sort children lists for determinism
  for (const kids of children.values()) {
    kids.sort();
  }

  // Find roots (no deps)
  const roots = names.filter((n) => parents.get(n)!.length === 0).sort();

  const lines: string[] = [];
  const rendered = new Set<string>();

  function suffix(name: string): string {
    const comp = components[name];
    const stability =
      showStability && comp.stability ? ` ${ASCII_STABILITY_BADGES[comp.stability] ?? ""}` : "";
    const tags = hasTags
      ? renderTagMarkers(comp.tags ?? [], tagIndex, tagMode as "color" | "superscript")
      : "";
    return `${stability}${tags ? " " + tags : ""}`;
  }

  function renderNode(name: string, prefix: string, isLast: boolean, isRoot: boolean): void {
    const nodeParents = parents.get(name)!;
    const isMultiParent = nodeParents.length > 1;

    // For multi-parent nodes, show parent names as context before the node
    if (isMultiParent && !isRoot) {
      lines.push(`${prefix}${nodeParents.join(" ")}`);
    }

    const connector = isRoot ? "" : isLast ? "└── " : "├── ";
    lines.push(`${prefix}${connector}${name}${suffix(name)}`);
    rendered.add(name);

    const childPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
    const kids = children.get(name) ?? [];

    // Collect children ready to render (all their parents are rendered)
    const newKids: string[] = [];
    for (const kid of kids) {
      if (rendered.has(kid)) continue;
      const kidParents = parents.get(kid)!;
      if (kidParents.every((p) => rendered.has(p) || p === name)) {
        newKids.push(kid);
      }
    }

    for (let i = 0; i < newKids.length; i++) {
      renderNode(newKids[i], childPrefix, i === newKids.length - 1, false);
    }
  }

  // Render from roots using tree-like DFS
  for (let i = 0; i < roots.length; i++) {
    renderNode(roots[i], "", i === roots.length - 1, true);
  }

  // Handle nodes that weren't rendered (multi-parent nodes deferred)
  let progress = true;
  while (progress) {
    progress = false;
    for (const name of names) {
      if (rendered.has(name)) continue;
      const nodeParents = parents.get(name)!;
      if (nodeParents.every((p) => rendered.has(p))) {
        lines.push(`    ${nodeParents.join(" ")}`);
        lines.push(`    └── ${name}${suffix(name)}`);
        rendered.add(name);
        progress = true;

        const kids = (children.get(name) ?? []).filter((k) => !rendered.has(k));
        const readyKids = kids.filter((k) =>
          parents.get(k)!.every((p) => rendered.has(p) || p === name),
        );
        for (let i = 0; i < readyKids.length; i++) {
          renderNode(readyKids[i], "        ", i === readyKids.length - 1, false);
        }
      }
    }
  }

  // Append tag legend if tags were shown
  if (hasTags) {
    lines.push("");
    lines.push(renderTagLegend(tagIndex, tagMode as "color" | "superscript"));
  }

  return lines.join("\n");
}

/**
 * Render components grouped by tag. Shows which components belong to each tag.
 */
export function renderTagGroups(manifest: Manifest): string {
  const tagToComponents = new Map<string, string[]>();

  for (const [name, comp] of Object.entries(manifest.components)) {
    for (const tag of comp.tags ?? []) {
      let list = tagToComponents.get(tag);
      if (!list) {
        list = [];
        tagToComponents.set(tag, list);
      }
      list.push(name);
    }
  }

  // Components with no tags
  const untagged = Object.keys(manifest.components).filter(
    (name) => !manifest.components[name].tags?.length,
  );

  const lines: string[] = [];
  const sortedTags = [...tagToComponents.keys()].sort();

  for (const tag of sortedTags) {
    const components = tagToComponents.get(tag)!.sort();
    lines.push(`[${tag}] ${components.join(", ")}`);
  }

  if (untagged.length > 0) {
    lines.push(`[untagged] ${untagged.sort().join(", ")}`);
  }

  return lines.join("\n");
}
