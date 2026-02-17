import type { Manifest } from "../types.js";

/**
 * Build a reverse dependency map: for each component, which components depend on it.
 */
function buildReverseDeps(manifest: Manifest): Map<string, string[]> {
  const reverse = new Map<string, string[]>();

  for (const name of Object.keys(manifest.components)) {
    reverse.set(name, []);
  }

  for (const [name, component] of Object.entries(manifest.components)) {
    for (const dep of component.deps ?? []) {
      const dependents = reverse.get(dep);
      if (dependents) {
        dependents.push(name);
      }
    }
  }

  return reverse;
}

/**
 * Given a list of changed components, walk deps in reverse (BFS)
 * to return all transitively affected components.
 * The changed components themselves are included in the result.
 */
export function invalidationCascade(manifest: Manifest, changed: string[]): string[] {
  const reverse = buildReverseDeps(manifest);
  const visited = new Set<string>();
  const queue = [...changed];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);

    const dependents = reverse.get(current) ?? [];
    for (const dep of dependents) {
      if (!visited.has(dep)) {
        queue.push(dep);
      }
    }
  }

  return [...visited];
}

/**
 * Validate the dependency graph for cycles using Kahn's algorithm (topological sort).
 * Returns null if acyclic, or the list of components involved in cycles.
 */
export function validateDependencyGraph(
  manifest: Manifest,
): { valid: true } | { valid: false; cycles: string[] } {
  const components = Object.keys(manifest.components);
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const name of components) {
    inDegree.set(name, 0);
    adjacency.set(name, []);
  }

  // Build forward adjacency and count in-degrees
  for (const [name, component] of Object.entries(manifest.components)) {
    for (const dep of component.deps ?? []) {
      // dep -> name (name depends on dep)
      adjacency.get(dep)?.push(name);
      inDegree.set(name, (inDegree.get(name) ?? 0) + 1);
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: string[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    sorted.push(current);

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  if (sorted.length === components.length) {
    return { valid: true };
  }

  // Components not in sorted list are involved in cycles
  const inCycle = components.filter((c) => !sorted.includes(c));
  return { valid: false, cycles: inCycle };
}
