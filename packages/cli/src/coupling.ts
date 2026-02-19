import { dirname, resolve } from "path";

import {
  buildCouplingMatrix,
  componentCouplingProfile,
  findHiddenCoupling,
  parseManifest,
  scanCoChangesWithCache,
  scanImports,
} from "@varp/core/lib";

import { DEFAULT_MANIFEST, parseEnum } from "./args.js";

export interface CouplingArgs {
  manifest: string;
  format: "text" | "json";
  component?: string;
  hotspots: boolean;
}

export function parseCouplingArgs(argv: string[]): CouplingArgs {
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";
  let component: string | undefined;
  let hotspots = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i], ["text", "json"] as const, "format");
    } else if (arg === "--component" && argv[i + 1]) {
      component = argv[++i];
    } else if (arg === "--hotspots") {
      hotspots = true;
    }
  }

  return { manifest, format, component, hotspots };
}

export async function runCouplingCommand(argv: string[]): Promise<void> {
  const args = parseCouplingArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifestDir = dirname(manifestPath);
  const manifest = parseManifest(manifestPath);
  const coChange = scanCoChangesWithCache(manifestDir);
  const imports = scanImports(manifest, manifestDir);
  const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: manifestDir });

  if (args.format === "json") {
    if (args.hotspots) {
      const hotspots = findHiddenCoupling(matrix);
      console.log(JSON.stringify({ hotspots, total: hotspots.length }, null, 2));
    } else if (args.component) {
      const profile = componentCouplingProfile(matrix, args.component);
      console.log(JSON.stringify({ entries: profile, component: args.component }, null, 2));
    } else {
      console.log(JSON.stringify(matrix, null, 2));
    }
    return;
  }

  // Text format
  if (args.hotspots) {
    const hotspots = findHiddenCoupling(matrix);
    if (hotspots.length === 0) {
      console.log("No hidden coupling detected.");
      return;
    }
    console.log(`Hidden coupling hotspots (${hotspots.length}):\n`);
    for (const entry of hotspots) {
      console.log(
        `  ${entry.pair[0]} <-> ${entry.pair[1]}  behavioral=${entry.behavioral_weight.toFixed(2)}`,
      );
    }
    return;
  }

  const entries = args.component
    ? componentCouplingProfile(matrix, args.component)
    : matrix.entries;

  if (entries.length === 0) {
    console.log("No coupling data found.");
    return;
  }

  console.log(
    `Coupling matrix (thresholds: structural=${matrix.structural_threshold.toFixed(2)}, behavioral=${matrix.behavioral_threshold.toFixed(2)}):\n`,
  );

  // Group by classification
  const groups = new Map<string, typeof entries>();
  for (const entry of entries) {
    const list = groups.get(entry.classification) ?? [];
    list.push(entry);
    groups.set(entry.classification, list);
  }

  const labels: Record<string, string> = {
    hidden_coupling: "HIDDEN COUPLING",
    explicit_module: "EXPLICIT MODULE",
    stable_interface: "STABLE INTERFACE",
    unrelated: "UNRELATED",
  };

  for (const [classification, label] of Object.entries(labels)) {
    const group = groups.get(classification);
    if (!group?.length) continue;
    console.log(`  ${label}:`);
    for (const entry of group) {
      console.log(
        `    ${entry.pair[0]} <-> ${entry.pair[1]}  s=${entry.structural_weight.toFixed(1)} b=${entry.behavioral_weight.toFixed(1)}`,
      );
    }
  }
}
