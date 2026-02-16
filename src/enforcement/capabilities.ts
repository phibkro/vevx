import { resolve, relative } from "node:path";
import type { Manifest, Touches, CapabilityReport, Violation } from "../types.js";

/**
 * Given modified file paths, check each falls within the declared write set's
 * component boundaries. Returns violations for any out-of-scope writes.
 */
export function verifyCapabilities(
  manifest: Manifest,
  touches: Touches,
  diffPaths: string[],
): CapabilityReport {
  const violations: Violation[] = [];
  const writeComponents = new Set(touches.writes ?? []);

  // Build a map of component paths for lookup, sorted by descending path length
  // so longer (more specific) paths match first when components overlap
  const componentPaths = Object.entries(manifest.components)
    .map(([name, comp]) => ({
      name,
      path: resolve(comp.path),
    }))
    .sort((a, b) => b.path.length - a.path.length);

  for (const filePath of diffPaths) {
    const absPath = resolve(filePath);

    // Find which component this file belongs to
    let actualComponent: string | null = null;
    for (const { name, path } of componentPaths) {
      const rel = relative(path, absPath);
      if (!rel.startsWith("..") && !rel.startsWith("/")) {
        actualComponent = name;
        break;
      }
    }

    if (actualComponent === null) {
      // File is outside all components — may or may not be a violation
      // depending on whether the touches declare any writes
      if (writeComponents.size > 0) {
        violations.push({
          path: filePath,
          declared_component: null,
          actual_component: "outside all components",
        });
      }
      continue;
    }

    // Check if the actual component is in the declared write set
    if (!writeComponents.has(actualComponent)) {
      violations.push({
        path: filePath,
        declared_component: null,
        actual_component: actualComponent,
      });
    }
  }

  return {
    valid: violations.length === 0,
    violations,
  };
}
