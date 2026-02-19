import { dirname, resolve } from "path";

import type { CouplingClassification, CoChangeEdge, Manifest } from "@varp/core/lib";
import {
  buildCouplingMatrix,
  componentCouplingProfile,
  findHiddenCoupling,
  findOwningComponent,
  buildComponentPaths,
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
  files: boolean;
  noColor: boolean;
}

export function parseCouplingArgs(argv: string[]): CouplingArgs {
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";
  let component: string | undefined;
  let hotspots = false;
  let files = false;
  let noColor = false;

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
    } else if (arg === "--files") {
      files = true;
    } else if (arg === "--no-color") {
      noColor = true;
    }
  }

  return { manifest, format, component, hotspots, files, noColor };
}

// ── File-level edge list ──

interface FileEdgeEntry {
  fileA: string;
  fileB: string;
  weight: number;
  commitCount: number;
  classification: CouplingClassification;
}

function classifyFileEdge(
  edge: CoChangeEdge,
  manifest: Manifest,
  componentPaths: ReturnType<typeof buildComponentPaths>,
  repoDir: string,
  structuralThreshold: number,
  behavioralThreshold: number,
  importPairs: Set<string>,
): FileEdgeEntry {
  const absA = resolve(repoDir, edge.files[0]);
  const absB = resolve(repoDir, edge.files[1]);
  const compA = findOwningComponent(absA, manifest, componentPaths);
  const compB = findOwningComponent(absB, manifest, componentPaths);

  // Check structural relationship via import pairs
  const pairKey =
    edge.files[0] < edge.files[1]
      ? `${edge.files[0]}\0${edge.files[1]}`
      : `${edge.files[1]}\0${edge.files[0]}`;
  const hasImport = importPairs.has(pairKey);
  const structural = hasImport ? structuralThreshold + 1 : 0;
  const behavioral = edge.weight;

  const highStructural = structural >= structuralThreshold;
  const highBehavioral = behavioral >= behavioralThreshold;

  let classification: CouplingClassification;
  if (compA && compB && compA === compB) {
    // Intra-component: treat as explicit module
    classification = "explicit_module";
  } else if (highStructural && highBehavioral) {
    classification = "explicit_module";
  } else if (highStructural && !highBehavioral) {
    classification = "stable_interface";
  } else if (!highStructural && highBehavioral) {
    classification = "hidden_coupling";
  } else {
    classification = "unrelated";
  }

  return {
    fileA: edge.files[0],
    fileB: edge.files[1],
    weight: edge.weight,
    commitCount: edge.commit_count,
    classification,
  };
}

function buildImportPairSet(imports: ReturnType<typeof scanImports>): Set<string> {
  const pairs = new Set<string>();
  for (const dep of imports.import_deps) {
    for (const ev of dep.evidence) {
      const a = ev.source_file;
      const b = ev.import_specifier;
      const key = a < b ? `${a}\0${b}` : `${b}\0${a}`;
      pairs.add(key);
    }
  }
  return pairs;
}

// ── Rendering ──

const FILLED = "\u2588";
const EMPTY = "\u2591";
const BAR_WIDTH = 10;

function renderBar(weight: number, maxWeight: number): string {
  const ratio = maxWeight > 0 ? weight / maxWeight : 0;
  const filled = Math.round(ratio * BAR_WIDTH);
  return FILLED.repeat(filled) + EMPTY.repeat(BAR_WIDTH - filled);
}

const QUADRANT_LABELS: Record<CouplingClassification, string> = {
  hidden_coupling: "Hidden Coupling (high co-change, low imports)",
  explicit_module: "Explicit Modules (high co-change, high imports)",
  stable_interface: "Stable Interfaces (high imports, low co-change)",
  unrelated: "Unrelated (low co-change, low imports)",
};

const QUADRANT_ORDER: CouplingClassification[] = [
  "hidden_coupling",
  "explicit_module",
  "stable_interface",
  "unrelated",
];

// ANSI color codes
const ANSI = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

const QUADRANT_COLORS: Record<CouplingClassification, string> = {
  hidden_coupling: ANSI.red,
  explicit_module: ANSI.green,
  stable_interface: ANSI.blue,
  unrelated: ANSI.dim,
};

function formatFileEdges(entries: FileEdgeEntry[], useColor: boolean): string {
  const groups = new Map<CouplingClassification, FileEdgeEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.classification) ?? [];
    list.push(entry);
    groups.set(entry.classification, list);
  }

  // Sort each group by weight descending
  for (const list of groups.values()) {
    list.sort((a, b) => b.weight - a.weight);
  }

  // Find max weight for bar scaling
  const maxWeight = entries.reduce((max, e) => Math.max(max, e.weight), 0);

  // Find max file pair width for alignment
  let maxPairLen = 0;
  for (const list of groups.values()) {
    for (const e of list) {
      const pairLen = e.fileA.length + e.fileB.length + 3; // " \u2194 "
      if (pairLen > maxPairLen) maxPairLen = pairLen;
    }
  }

  const lines: string[] = [];

  for (const classification of QUADRANT_ORDER) {
    const group = groups.get(classification);
    if (!group?.length) continue;

    const color = useColor ? QUADRANT_COLORS[classification] : "";
    const reset = useColor ? ANSI.reset : "";

    lines.push(`${color}${QUADRANT_LABELS[classification]}:${reset}`);
    for (const entry of group) {
      const pair = `${entry.fileA} \u2194 ${entry.fileB}`;
      const padded = pair.padEnd(maxPairLen);
      const weightStr = entry.weight.toFixed(2).padStart(6);
      const bar = renderBar(entry.weight, maxWeight);
      lines.push(`${color}  ${padded}  ${weightStr}  ${bar}${reset}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ── Main command ──

export async function runCouplingCommand(argv: string[]): Promise<void> {
  const args = parseCouplingArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifestDir = dirname(manifestPath);
  const manifest = parseManifest(manifestPath);
  const coChange = scanCoChangesWithCache(manifestDir);
  const imports = scanImports(manifest, manifestDir);
  const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: manifestDir });

  if (args.files) {
    const compPaths = buildComponentPaths(manifest);
    const importPairs = buildImportPairSet(imports);

    const entries = coChange.edges.map((edge) =>
      classifyFileEdge(
        edge,
        manifest,
        compPaths,
        manifestDir,
        matrix.structural_threshold,
        matrix.behavioral_threshold,
        importPairs,
      ),
    );

    if (args.format === "json") {
      const groups: Record<string, FileEdgeEntry[]> = {};
      for (const entry of entries) {
        (groups[entry.classification] ??= []).push(entry);
      }
      for (const list of Object.values(groups)) {
        list.sort((a, b) => b.weight - a.weight);
      }
      console.log(JSON.stringify({ edges: entries.length, groups }, null, 2));
      return;
    }

    const useColor = !args.noColor;
    const output = formatFileEdges(entries, useColor);
    if (output.trim()) {
      console.log(output);
    } else {
      console.log("No file-level co-change edges found.");
    }
    return;
  }

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
