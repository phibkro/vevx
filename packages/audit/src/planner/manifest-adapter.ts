import { readFileSync, existsSync, statSync } from 'fs';
import { resolve, dirname, relative, join } from 'path';
import YAML from 'yaml';
import { componentPaths } from '@varp/core/lib';
import type { Manifest, Component } from '@varp/core/lib';
import type { AuditComponent } from './types';
import type { Rule } from './types';

export type { Manifest, Component };

// ── Manifest discovery ──

/**
 * Walk up from targetPath looking for varp.yaml.
 * Returns the absolute path if found, null otherwise.
 */
export function findManifest(targetPath: string): string | null {
  let dir = resolve(targetPath);

  // If targetPath is a file, start from its directory
  if (existsSync(dir) && statSync(dir).isFile()) {
    dir = dirname(dir);
  }

  const root = resolve('/');
  while (true) {
    const candidate = join(dir, 'varp.yaml');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir || parent === root) break;
    dir = parent;
  }

  return null;
}

/**
 * Parse a varp.yaml file into a Manifest.
 * Minimal parser — only extracts what audit needs (paths, tags, deps).
 */
export function parseManifest(manifestPath: string): Manifest {
  const raw = readFileSync(resolve(manifestPath), 'utf-8');
  const parsed = YAML.parse(raw);

  if (typeof parsed !== 'object' || parsed === null || !('varp' in parsed)) {
    throw new Error('Invalid manifest: missing \'varp\' key');
  }

  const { varp, ...rest } = parsed as Record<string, unknown>;

  if (typeof varp !== 'string') {
    throw new Error('Invalid manifest: \'varp\' must be a string');
  }

  const baseDir = dirname(resolve(manifestPath));
  const components: Record<string, Component> = {};

  for (const [name, value] of Object.entries(rest)) {
    if (typeof value !== 'object' || value === null) continue;
    const raw = value as Record<string, unknown>;

    const path = raw.path;
    if (!path) continue;

    // Resolve paths relative to manifest directory
    let resolvedPath: string | string[];
    if (Array.isArray(path)) {
      resolvedPath = path.map(p => resolve(baseDir, String(p)));
    } else {
      resolvedPath = resolve(baseDir, String(path));
    }

    components[name] = {
      path: resolvedPath,
      deps: Array.isArray(raw.deps) ? raw.deps.map(String) : undefined,
      tags: Array.isArray(raw.tags) ? raw.tags.map(String) : undefined,
      docs: Array.isArray(raw.docs) ? raw.docs.map(String) : [],
      test: typeof raw.test === 'string' ? raw.test : undefined,
      stability: typeof raw.stability === 'string' ? raw.stability as Component['stability'] : undefined,
    };
  }

  return { varp, components };
}

// ── Component loading ──

/**
 * Load manifest components and convert to AuditComponent[].
 * Returns null if no manifest is found (caller falls back to heuristic).
 *
 * Only includes components whose paths overlap with the target directory.
 */
export function loadManifestComponents(
  targetPath: string,
  manifestPath?: string,
): { components: AuditComponent[]; manifest: Manifest } | null {
  const resolved = manifestPath ?? findManifest(targetPath);
  if (!resolved) return null;

  const manifest = parseManifest(resolved);
  const target = resolve(targetPath);

  const auditComponents: AuditComponent[] = [];

  for (const [name, comp] of Object.entries(manifest.components)) {
    const paths = componentPaths(comp);

    // Only include components under the audit target
    const relevantPaths = paths.filter(p => {
      const rel = relative(target, p);
      return !rel.startsWith('..');
    });

    if (relevantPaths.length === 0) continue;

    auditComponents.push({
      name,
      path: relevantPaths.length === 1 ? relevantPaths[0] : relevantPaths.join(', '),
      files: [], // populated later by matching discovered files to component paths
      languages: [],
      estimatedTokens: 0,
    });
  }

  return { components: auditComponents, manifest };
}

// ── Tag-based rule matching ──

/**
 * Check if a manifest component's tags match a rule's "applies to" tags.
 * Uses substring matching: component tag "audit" matches rule tag "audit logging".
 */
export function matchRulesByTags(componentTags: string[], rule: Rule): boolean {
  if (rule.appliesTo.length === 0) return true;
  if (!componentTags || componentTags.length === 0) return false;

  for (const ruleTag of rule.appliesTo) {
    const normalizedRule = ruleTag.toLowerCase().trim();
    for (const compTag of componentTags) {
      const normalizedComp = compTag.toLowerCase().trim();
      // Component tag found as substring in rule's appliesTo
      if (normalizedRule.includes(normalizedComp) || normalizedComp.includes(normalizedRule)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Assign discovered files to manifest components based on path containment.
 * A file belongs to a component if it's under any of the component's paths.
 */
export function assignFilesToComponents(
  components: AuditComponent[],
  manifest: Manifest,
  files: { relativePath: string; language: string; content: string }[],
  targetPath: string,
): void {
  const target = resolve(targetPath);

  for (const [_idx, comp] of components.entries()) {
    const manifestComp = manifest.components[comp.name];
    if (!manifestComp) continue;

    const compPaths = componentPaths(manifestComp);
    const matchedFiles: string[] = [];
    const langs = new Set<string>();
    let tokens = 0;

    for (const file of files) {
      const absFile = resolve(target, file.relativePath);
      const matches = compPaths.some(cp => {
        const rel = relative(cp, absFile);
        return !rel.startsWith('..');
      });

      if (matches) {
        matchedFiles.push(file.relativePath);
        langs.add(file.language);
        tokens += Math.ceil(file.content.length / 4); // rough estimate
      }
    }

    comp.files = matchedFiles;
    comp.languages = [...langs];
    comp.estimatedTokens = tokens;
  }
}
