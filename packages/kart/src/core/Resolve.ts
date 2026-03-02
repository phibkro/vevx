/**
 * TypeScript path resolution utilities.
 *
 * Handles tsconfig.json path aliases (including extends chains)
 * and specifier-to-absolute-path resolution.
 *
 * Copied from @vevx/varp manifest/imports.ts — kart is standalone,
 * no varp dependency. Only the resolution primitives, no import extraction.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// ── Types ──

export type ResolveFn = (specifier: string, fromDir: string) => string | null;

export type PathMapping = {
  readonly pattern: string;
  readonly targets: readonly string[];
};

export type PathAliases = {
  readonly mappings: readonly PathMapping[];
  readonly baseDir: string;
};

// ── tsconfig parsing ──

function stripJsonComments(text: string): string {
  return text.replace(/"(?:[^"\\]|\\.)*"|\/\/.*$|\/\*[\s\S]*?\*\//gm, (match) =>
    match.startsWith('"') ? match : "",
  );
}

interface TsconfigCompilerOptions {
  paths?: Record<string, string[]>;
  baseUrl?: string;
}

interface TsconfigRaw {
  extends?: string;
  compilerOptions?: TsconfigCompilerOptions;
}

function readTsconfig(filePath: string): TsconfigRaw | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(stripJsonComments(raw));
  } catch {
    return null;
  }
}

function resolveExtendsPath(specifier: string, fromDir: string): string | null {
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const resolved = resolve(fromDir, specifier);
    if (!resolved.endsWith(".json")) {
      if (existsSync(resolved + ".json")) return resolved + ".json";
      if (existsSync(resolved)) return resolved;
      return resolved + ".json";
    }
    return resolved;
  }

  const nmBase = join(fromDir, "node_modules", specifier);
  if (existsSync(nmBase) && !nmBase.endsWith(".json")) {
    const inner = join(nmBase, "tsconfig.json");
    if (existsSync(inner)) return inner;
  }
  if (existsSync(nmBase)) return nmBase;
  if (!nmBase.endsWith(".json") && existsSync(nmBase + ".json")) return nmBase + ".json";

  return null;
}

function resolveTsconfigOptions(
  filePath: string,
  visited: Set<string>,
): TsconfigCompilerOptions | null {
  const abs = resolve(filePath);
  if (visited.has(abs)) return null;
  visited.add(abs);

  const parsed = readTsconfig(abs);
  if (!parsed) return null;

  let parentOptions: TsconfigCompilerOptions = {};
  if (parsed.extends) {
    const parentPath = resolveExtendsPath(parsed.extends, dirname(abs));
    if (parentPath) {
      parentOptions = resolveTsconfigOptions(parentPath, visited) ?? {};
    }
  }

  const mergedPaths = { ...parentOptions.paths, ...parsed.compilerOptions?.paths };
  return {
    baseUrl: parsed.compilerOptions?.baseUrl ?? parentOptions.baseUrl,
    paths: Object.keys(mergedPaths).length > 0 ? mergedPaths : undefined,
  };
}

// ── Public API ──

export function loadTsconfigPaths(dir: string): PathAliases | null {
  const tsconfigPath = join(dir, "tsconfig.json");
  const options = resolveTsconfigOptions(tsconfigPath, new Set());
  if (!options) return null;

  const paths = options.paths;
  if (!paths || Object.keys(paths).length === 0) return null;

  const baseUrl = options.baseUrl ?? ".";
  const baseDir = resolve(dir, baseUrl);

  const mappings: PathMapping[] = Object.entries(paths).map(([pattern, targets]) => ({
    pattern,
    targets,
  }));

  return { mappings, baseDir };
}

export function aliasPrefixesFrom(aliases: PathAliases): string[] {
  return aliases.mappings.map((m) =>
    m.pattern.endsWith("/*") ? m.pattern.slice(0, -1) : m.pattern,
  );
}

export function resolveAlias(specifier: string, aliases: PathAliases): string | null {
  for (const mapping of aliases.mappings) {
    if (mapping.pattern.endsWith("/*")) {
      const prefix = mapping.pattern.slice(0, -1);
      if (specifier.startsWith(prefix)) {
        const rest = specifier.slice(prefix.length);
        const target = mapping.targets[0];
        if (!target) continue;
        const targetBase = target.endsWith("/*") ? target.slice(0, -1) : target;
        return resolve(aliases.baseDir, targetBase + rest);
      }
    } else {
      if (specifier === mapping.pattern) {
        const target = mapping.targets[0];
        if (!target) continue;
        return resolve(aliases.baseDir, target);
      }
    }
  }
  return null;
}

export function resolveSpecifier(
  specifier: string,
  fromDir: string,
  resolveFn: ResolveFn,
  aliases?: PathAliases,
): string | null {
  if (aliases && !specifier.startsWith("./") && !specifier.startsWith("../")) {
    const aliased = resolveAlias(specifier, aliases);
    if (aliased) return resolveFn(aliased, fromDir) ?? aliased;
  }
  return resolveFn(specifier, fromDir);
}

export function bunResolve(specifier: string, fromDir: string): string | null {
  try {
    return Bun.resolveSync(specifier, fromDir);
  } catch {
    return null;
  }
}
