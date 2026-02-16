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

  // Resolve component paths and doc paths
  for (const [, component] of Object.entries(manifest.components)) {
    component.path = resolve(baseDir, component.path);
    for (const doc of component.docs) {
      doc.path = resolve(baseDir, doc.path);
    }
  }

  // Resolve project-level doc paths
  if (manifest.docs) {
    for (const [, doc] of Object.entries(manifest.docs)) {
      doc.path = resolve(baseDir, doc.path);
    }
  }

  return manifest;
}
