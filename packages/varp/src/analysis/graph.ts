import { dirname, resolve } from "node:path";

import type { CodebaseGraph, FilterConfig } from "#shared/types.js";

import { scanImports } from "../manifest/imports.js";
import { parseManifest } from "../manifest/parser.js";
import { scanCoChangesWithCache } from "./cache.js";
import { buildCouplingMatrix } from "./matrix.js";

export interface BuildGraphOptions {
  filterConfig?: Partial<FilterConfig>;
  withCoupling?: boolean;
}

export function buildCodebaseGraph(
  manifestPath: string,
  options?: BuildGraphOptions,
): CodebaseGraph {
  const absPath = resolve(manifestPath);
  const manifestDir = dirname(absPath);
  const manifest = parseManifest(manifestPath);
  const coChange = scanCoChangesWithCache(manifestDir, options?.filterConfig);
  const imports = scanImports(manifest, manifestDir);

  const graph: CodebaseGraph = { manifest, coChange, imports };

  if (options?.withCoupling) {
    graph.coupling = buildCouplingMatrix(coChange, imports, manifest, {
      repo_dir: manifestDir,
    });
  }

  return graph;
}
