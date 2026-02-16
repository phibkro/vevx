import { parse as parseYaml } from "yaml";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { ManifestSchema, type Manifest } from "../types.js";

/**
 * Parse a varp.yaml manifest file. Resolves relative doc paths to absolute
 * paths relative to the manifest file's directory.
 */
export function parseManifest(manifestPath: string): Manifest {
  const absolutePath = resolve(manifestPath);
  const baseDir = dirname(absolutePath);
  const raw = readFileSync(absolutePath, "utf-8");
  const parsed = parseYaml(raw);

  const manifest = ManifestSchema.parse(parsed);

  // Resolve relative paths to absolute
  for (const [, component] of Object.entries(manifest.components)) {
    component.path = resolve(baseDir, component.path);
    component.docs.interface = resolve(baseDir, component.docs.interface);
    component.docs.internal = resolve(baseDir, component.docs.internal);
  }

  return manifest;
}
