import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import {
  buildCouplingMatrix,
  checkFreshness,
  findHiddenCoupling,
  parseManifest,
  scanCoChangesWithCache,
  scanImports,
} from "@varp/core/lib";

import { DEFAULT_MANIFEST, parseEnum } from "./args.js";

// ── Types ──

export interface ComponentSummary {
  name: string;
  path: string | string[];
  stability: string;
  tags: string[];
}

export interface CouplingHotspot {
  pair: [string, string];
  behavioral_weight: number;
}

export interface ProjectSummary {
  components: ComponentSummary[];
  stale_docs: number;
  total_docs: number;
  coupling_hotspots: CouplingHotspot[];
  /** Map of file path to coupling neighbor descriptions (for hook consumption) */
  hotspot_files: Record<string, string[]>;
}

// ── Pure computation ──

export function computeSummary(manifestPath: string): ProjectSummary {
  const absPath = resolve(manifestPath);
  const manifestDir = dirname(absPath);
  const manifest = parseManifest(absPath);

  // Components
  const components: ComponentSummary[] = Object.entries(manifest.components).map(
    ([name, comp]) => ({
      name,
      path: Array.isArray(comp.path)
        ? comp.path.map((p) => relative(manifestDir, p))
        : relative(manifestDir, comp.path),
      stability: comp.stability ?? "unknown",
      tags: comp.tags ?? [],
    }),
  );

  // Freshness
  const freshness = checkFreshness(manifest, manifestDir);
  let stale = 0;
  let total = 0;
  for (const comp of Object.values(freshness.components)) {
    for (const doc of Object.values(comp.docs)) {
      total++;
      if (doc.stale) stale++;
    }
  }

  // Coupling (graceful degradation if no git history)
  let couplingHotspots: CouplingHotspot[] = [];
  const hotspotFiles: Record<string, string[]> = {};

  try {
    const coChange = scanCoChangesWithCache(manifestDir);
    if (coChange.edges.length > 0) {
      const imports = scanImports(manifest, manifestDir);
      const matrix = buildCouplingMatrix(coChange, imports, manifest, {
        repo_dir: manifestDir,
      });
      const hidden = findHiddenCoupling(matrix);

      couplingHotspots = hidden.slice(0, 5).map((h) => ({
        pair: h.pair as [string, string],
        behavioral_weight: h.behavioral_weight,
      }));

      // Build file-level hotspot map from high-behavioral co-change edges
      for (const edge of coChange.edges) {
        const [a, b] = edge.files;
        if (edge.weight >= matrix.behavioral_threshold) {
          if (!hotspotFiles[a]) hotspotFiles[a] = [];
          if (!hotspotFiles[b]) hotspotFiles[b] = [];
          hotspotFiles[a].push(`${b} (${edge.weight.toFixed(2)})`);
          hotspotFiles[b].push(`${a} (${edge.weight.toFixed(2)})`);
        }
      }

      // Cap neighbors per file to top 5 by weight (descending)
      const weightRe = /\((\d+\.\d+)\)$/;
      for (const file of Object.keys(hotspotFiles)) {
        if (hotspotFiles[file].length > 5) {
          hotspotFiles[file].sort((a, b) => {
            const wa = Number(a.match(weightRe)?.[1] ?? 0);
            const wb = Number(b.match(weightRe)?.[1] ?? 0);
            return wb - wa;
          });
          hotspotFiles[file] = hotspotFiles[file].slice(0, 5);
        }
      }
    }
  } catch {
    // No git history or shallow clone — skip coupling
  }

  return {
    components,
    stale_docs: stale,
    total_docs: total,
    coupling_hotspots: couplingHotspots,
    hotspot_files: hotspotFiles,
  };
}

// ── Formatting ──

function formatText(summary: ProjectSummary): string {
  const lines: string[] = [];

  const compNames = summary.components.map((c) => c.name).join(", ");
  lines.push(`Components (${summary.components.length}): ${compNames}`);

  if (summary.stale_docs > 0) {
    lines.push(`Docs: ${summary.stale_docs}/${summary.total_docs} stale`);
  } else {
    lines.push(`Docs: ${summary.total_docs} total, all fresh`);
  }

  if (summary.coupling_hotspots.length > 0) {
    lines.push(`Hidden coupling (${summary.coupling_hotspots.length}):`);
    for (const h of summary.coupling_hotspots) {
      lines.push(`  ${h.pair[0]} <-> ${h.pair[1]}  weight=${h.behavioral_weight.toFixed(2)}`);
    }
  }

  return lines.join("\n");
}

// ── Cache write ──

function writeSummaryCache(manifestPath: string, summary: ProjectSummary): void {
  const varpDir = join(dirname(resolve(manifestPath)), ".varp");
  mkdirSync(varpDir, { recursive: true });
  writeFileSync(join(varpDir, "summary.json"), JSON.stringify(summary, null, 2));
}

// ── CLI command ──

export function parseSummaryArgs(argv: string[]): { manifest: string; format: "text" | "json" } {
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i], ["text", "json"] as const, "format");
    } else if (arg === "--json") {
      format = "json";
    }
  }

  return { manifest, format };
}

export async function runSummaryCommand(argv: string[]): Promise<void> {
  const args = parseSummaryArgs(argv);
  const summary = computeSummary(args.manifest);

  // Always write cache for hook consumption
  writeSummaryCache(args.manifest, summary);

  if (args.format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatText(summary));
  }
}
