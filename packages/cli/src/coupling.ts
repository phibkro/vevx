import { dirname, resolve } from "path";

import type { CouplingClassification, CoChangeEdge, Manifest, TrendInfo } from "@varp/core/lib";
import {
  buildCouplingMatrix,
  componentCouplingProfile,
  computeComplexityTrends,
  fileNeighborhood,
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
  neighborhood?: string;
  hotspots: boolean;
  files: boolean;
  noColor: boolean;
}

export function parseCouplingArgs(argv: string[]): CouplingArgs {
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";
  let component: string | undefined;
  let neighborhood: string | undefined;
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
    } else if (arg === "--neighborhood" && argv[i + 1]) {
      neighborhood = argv[++i];
    } else if (arg === "--hotspots") {
      hotspots = true;
    } else if (arg === "--files") {
      files = true;
    } else if (arg === "--no-color") {
      noColor = true;
    }
  }

  return { manifest, format, component, neighborhood, hotspots, files, noColor };
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

// ── Trend sparklines ──

function renderSparkline(trend: TrendInfo | undefined): string {
  if (!trend || trend.direction === "stable") return "\u2583\u2583\u2583 (stable)";
  if (trend.direction === "increasing") return "\u2582\u2585\u2588 (increasing)";
  return "\u2588\u2585\u2582 (decreasing)";
}

// ── Neighborhood rendering ──

interface NeighborTier {
  label: string;
  entries: Array<{
    file: string;
    weight: number;
    tag: string;
    trend: TrendInfo | undefined;
  }>;
}

function formatNeighborhood(
  file: string,
  owningComponent: string | undefined,
  tiers: NeighborTier[],
  _useColor: boolean,
): string {
  const lines: string[] = [];
  const header = owningComponent ? `${file} (${owningComponent})` : file;
  lines.push(header);
  lines.push("");

  for (const tier of tiers) {
    if (tier.entries.length === 0) continue;
    lines.push(`${tier.label}:`);

    let maxFileLen = 0;
    for (const e of tier.entries) {
      if (e.file.length > maxFileLen) maxFileLen = e.file.length;
    }

    for (const entry of tier.entries) {
      const padded = entry.file.padEnd(maxFileLen);
      const weightStr = entry.weight.toFixed(2).padStart(6);
      const tag = `[${entry.tag}]`.padEnd(18);
      const spark = renderSparkline(entry.trend);
      lines.push(`  ${padded}  ${weightStr}  ${tag}  ${spark}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function pickTrend(a: TrendInfo | undefined, b: TrendInfo | undefined): TrendInfo | undefined {
  if (!a && !b) return undefined;
  if (!a) return b;
  if (!b) return a;
  // Prefer non-stable
  if (a.direction !== "stable" && b.direction === "stable") return a;
  if (b.direction !== "stable" && a.direction === "stable") return b;
  return a.magnitude >= b.magnitude ? a : b;
}

function formatFileEdges(
  entries: FileEdgeEntry[],
  useColor: boolean,
  trends?: Record<string, TrendInfo>,
): string {
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
      const trendA = trends?.[entry.fileA];
      const trendB = trends?.[entry.fileB];
      // Pick the more interesting trend (non-stable, or higher magnitude)
      const trend = pickTrend(trendA, trendB);
      const spark = trends ? `  ${renderSparkline(trend)}` : "";
      lines.push(`${color}  ${padded}  ${weightStr}  ${bar}${spark}${reset}`);
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

  // ── Neighborhood mode ──
  if (args.neighborhood) {
    const file = args.neighborhood;
    const neighbors = fileNeighborhood(file, coChange.edges, imports);
    const allFiles = [file, ...neighbors.map((n) => n.file)];
    const trends = computeComplexityTrends(manifestDir, allFiles);
    const compPaths = buildComponentPaths(manifest);
    const absFile = resolve(manifestDir, file);
    const owningComponent = findOwningComponent(absFile, manifest, compPaths);

    const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: manifestDir });
    const bThreshold = matrix.behavioral_threshold;

    if (args.format === "json") {
      const direct = neighbors
        .filter((n) => n.coChangeWeight >= bThreshold)
        .map((n) => ({ ...n, trend: trends[n.file] }));
      const moderate = neighbors
        .filter((n) => n.coChangeWeight > 0 && n.coChangeWeight < bThreshold)
        .map((n) => ({ ...n, trend: trends[n.file] }));
      const structuralOnly = neighbors
        .filter((n) => n.coChangeWeight === 0 && n.hasImportRelation)
        .map((n) => ({ ...n, trend: trends[n.file] }));
      console.log(
        JSON.stringify(
          {
            file,
            component: owningComponent,
            tiers: { direct, moderate, structural_only: structuralOnly },
          },
          null,
          2,
        ),
      );
      return;
    }

    const classify = (n: { hasImportRelation: boolean }) =>
      n.hasImportRelation ? "explicit" : "hidden";

    const tiers: NeighborTier[] = [
      {
        label: `Direct (co-change \u2265 ${bThreshold.toFixed(2)})`,
        entries: neighbors
          .filter((n) => n.coChangeWeight >= bThreshold)
          .map((n) => ({
            file: n.file,
            weight: n.coChangeWeight,
            tag: classify(n),
            trend: trends[n.file],
          })),
      },
      {
        label: `Moderate (0 < co-change < ${bThreshold.toFixed(2)})`,
        entries: neighbors
          .filter((n) => n.coChangeWeight > 0 && n.coChangeWeight < bThreshold)
          .map((n) => ({
            file: n.file,
            weight: n.coChangeWeight,
            tag: classify(n),
            trend: trends[n.file],
          })),
      },
      {
        label: "Structural only (imports, no co-change)",
        entries: neighbors
          .filter((n) => n.coChangeWeight === 0 && n.hasImportRelation)
          .map((n) => ({
            file: n.file,
            weight: 0,
            tag: "stable interface",
            trend: trends[n.file],
          })),
      },
    ];

    console.log(formatNeighborhood(file, owningComponent, tiers, !args.noColor));
    return;
  }

  const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: manifestDir });

  // ── File-level edges ──
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

    // Compute trends for all files in edges
    const allFiles = new Set<string>();
    for (const e of entries) {
      allFiles.add(e.fileA);
      allFiles.add(e.fileB);
    }
    const trends = computeComplexityTrends(manifestDir, [...allFiles]);

    if (args.format === "json") {
      const groups: Record<string, FileEdgeEntry[]> = {};
      for (const entry of entries) {
        (groups[entry.classification] ??= []).push(entry);
      }
      for (const list of Object.values(groups)) {
        list.sort((a, b) => b.weight - a.weight);
      }
      console.log(JSON.stringify({ edges: entries.length, groups, trends }, null, 2));
      return;
    }

    const useColor = !args.noColor;
    const output = formatFileEdges(entries, useColor, trends);
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
