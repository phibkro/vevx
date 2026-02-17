import { readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";

import { parse as parseYaml } from "yaml";

import { ComponentSchema, type Manifest } from "../types.js";

const manifestCache = new Map<string, { mtimeMs: number; manifest: Manifest }>();

/**
 * Parse a varp.yaml manifest file. Flat YAML format: `varp` key holds version,
 * all other top-level keys are component names. Resolves relative paths to
 * absolute paths relative to the manifest file's directory.
 */
export function parseManifest(manifestPath: string): Manifest {
  const absolutePath = resolve(manifestPath);
  const baseDir = dirname(absolutePath);

  // Cache by path + mtime to avoid redundant parsing
  const fileStat = statSync(absolutePath);
  const cached = manifestCache.get(absolutePath);
  if (cached && cached.mtimeMs === fileStat.mtimeMs) {
    return cached.manifest;
  }

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

    // Resolve component path and validate it stays within project
    component.path = resolve(baseDir, component.path);
    const compRel = relative(baseDir, component.path);
    if (compRel.startsWith("..") || isAbsolute(compRel)) {
      throw new Error(`Component '${name}' path escapes manifest directory: ${component.path}`);
    }

    // Resolve doc paths and validate they stay within project
    component.docs = component.docs.map((docPath) => {
      const resolved = resolve(baseDir, docPath);
      const docRel = relative(baseDir, resolved);
      if (docRel.startsWith("..") || isAbsolute(docRel)) {
        throw new Error(`Doc path escapes manifest directory: ${docPath}`);
      }
      return resolved;
    });

    components[name] = component;
  }

  const manifest: Manifest = { varp, components };
  manifestCache.set(absolutePath, { mtimeMs: fileStat.mtimeMs, manifest });
  return manifest;
}
