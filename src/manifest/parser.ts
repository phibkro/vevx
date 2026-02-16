import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ComponentSchema, type Manifest } from "../types.js";

/**
 * Parse a varp.yaml manifest file. Flat YAML format: `varp` key holds version,
 * all other top-level keys are component names. Resolves relative paths to
 * absolute paths relative to the manifest file's directory.
 */
export function parseManifest(manifestPath: string): Manifest {
  const absolutePath = resolve(manifestPath);
  const baseDir = dirname(absolutePath);
  const raw = readFileSync(absolutePath, "utf-8");
  const parsed = parseYaml(raw);

  if (typeof parsed !== "object" || parsed === null || !("varp" in parsed)) {
    throw new Error("Invalid manifest: missing 'varp' key");
  }

  const { varp, ...rest } = parsed as Record<string, unknown>;

  if (typeof varp !== "string") {
    throw new Error("Invalid manifest: 'varp' must be a string");
  }

  // Everything else is a component
  const components: Record<string, ReturnType<typeof ComponentSchema.parse>> = {};
  for (const [name, value] of Object.entries(rest)) {
    const component = ComponentSchema.parse(value);

    // Resolve component path
    component.path = resolve(baseDir, component.path);

    // Resolve doc paths (now plain strings)
    component.docs = component.docs.map((docPath) => resolve(baseDir, docPath));

    components[name] = component;
  }

  return { varp, components };
}
