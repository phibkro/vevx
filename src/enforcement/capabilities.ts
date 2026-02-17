import type { Manifest, Touches, CapabilityReport, Violation } from "../types.js";
import { findOwningComponent, buildComponentPaths } from "../manifest/ownership.js";

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
  const componentPaths = buildComponentPaths(manifest);

  for (const filePath of diffPaths) {
    const actualComponent = findOwningComponent(filePath, manifest, componentPaths);

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
