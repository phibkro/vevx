import { readFileSync, statSync } from "node:fs";
import { resolve, dirname, relative, isAbsolute } from "node:path";

const parseYaml = Bun.YAML.parse;

import { ComponentSchema, componentPaths, type Manifest } from "#shared/types.js";

const manifestCache = new Map<string, { mtimeMs: number; manifest: Manifest }>();

/**
 * Parse a varp.yaml manifest file. Flat YAML format: `varp` key holds version,
 * all other top-level keys are component names. Resolves relative paths to
 * absolute paths relative to the manifest file's directory.
 */

function resolveDeps(components: Record<string, ReturnType<typeof ComponentSchema.parse>>): void {
  // Build tag → component names map
  const tagMap = new Map<string, string[]>();
  for (const [name, comp] of Object.entries(components)) {
    for (const tag of comp.tags ?? []) {
      const list = tagMap.get(tag) ?? [];
      list.push(name);
      tagMap.set(tag, list);
    }
  }

  const componentNames = new Set(Object.keys(components));

  for (const [name, comp] of Object.entries(components)) {
    if (!comp.deps?.length) continue;

    const resolved = new Set<string>();
    for (const dep of comp.deps) {
      if (componentNames.has(dep)) {
        resolved.add(dep);
      } else if (tagMap.has(dep)) {
        for (const tagged of tagMap.get(dep)!) {
          if (tagged !== name) resolved.add(tagged);
        }
      } else {
        throw new Error(`Component "${name}": unknown dep "${dep}" (not a component name or tag)`);
      }
    }

    comp.deps = [...resolved];
  }
}

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

    // Resolve component paths and validate each stays within project
    const rawPaths = componentPaths(component);
    const resolvedPaths = rawPaths.map((p) => {
      const resolved = resolve(baseDir, p);
      const compRel = relative(baseDir, resolved);
      if (compRel.startsWith("..") || isAbsolute(compRel)) {
        throw new Error(`Component '${name}' path escapes manifest directory: ${resolved}`);
      }
      return resolved;
    });
    component.path = resolvedPaths.length === 1 ? resolvedPaths[0] : resolvedPaths;

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

  resolveDeps(components);

  const manifest: Manifest = { varp, components };
  manifestCache.set(absolutePath, { mtimeMs: fileStat.mtimeMs, manifest });
  return manifest;
}
