import { resolve } from "node:path";

import { buildComponentPaths, findOwningComponent } from "#shared/ownership.js";
import type {
  CoChangeGraph,
  CouplingClassification,
  CouplingEntry,
  CouplingMatrix,
  ImportScanResult,
  Manifest,
} from "#shared/types.js";

// ── Pure functions ──

interface MatrixOptions {
  structural_threshold?: number;
  behavioral_threshold?: number;
  repo_dir?: string;
}

/**
 * Classify a component pair into coupling quadrants.
 *
 *                    behavioral >= threshold
 *                    yes                    no
 * structural    yes  explicit_module        stable_interface
 * >= threshold  no   hidden_coupling        unrelated
 */
function classify(
  structural: number,
  behavioral: number,
  sThreshold: number,
  bThreshold: number,
): CouplingClassification {
  const highStructural = structural >= sThreshold;
  const highBehavioral = behavioral >= bThreshold;

  if (highStructural && highBehavioral) return "explicit_module";
  if (highStructural && !highBehavioral) return "stable_interface";
  if (!highStructural && highBehavioral) return "hidden_coupling";
  return "unrelated";
}

/**
 * Compute median of a numeric array. Returns 0 for empty arrays.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build a coupling matrix combining co-change (behavioral) and import (structural) signals.
 *
 * 1. Map file-level co-change edges to component pairs via ownership
 * 2. Aggregate to component-level behavioral weights
 * 3. Build structural weights from import evidence counts
 * 4. Classify each pair using auto-calibrated or manual thresholds
 */
export function buildCouplingMatrix(
  coChange: CoChangeGraph,
  imports: ImportScanResult,
  manifest: Manifest,
  options?: MatrixOptions,
): CouplingMatrix {
  const componentPaths = buildComponentPaths(manifest);
  const repoDir = options?.repo_dir ?? ".";

  // ── Behavioral signal: co-change edges → component pairs ──

  const behavioralMap = new Map<string, number>();

  for (const edge of coChange.edges) {
    const absA = resolve(repoDir, edge.files[0]);
    const absB = resolve(repoDir, edge.files[1]);
    const compA = findOwningComponent(absA, manifest, componentPaths);
    const compB = findOwningComponent(absB, manifest, componentPaths);

    if (!compA || !compB || compA === compB) continue;

    const [a, b] = compA < compB ? [compA, compB] : [compB, compA];
    const key = `${a}\0${b}`;
    behavioralMap.set(key, (behavioralMap.get(key) ?? 0) + edge.weight);
  }

  // ── Structural signal: import deps → component pairs ──

  const structuralMap = new Map<string, number>();

  for (const dep of imports.import_deps) {
    const [a, b] = dep.from < dep.to ? [dep.from, dep.to] : [dep.to, dep.from];
    const key = `${a}\0${b}`;
    // Weight by evidence count (number of import statements)
    structuralMap.set(key, (structuralMap.get(key) ?? 0) + dep.evidence.length);
  }

  // ── Merge all known pairs ──

  const allPairs = new Set([...behavioralMap.keys(), ...structuralMap.keys()]);
  const raw: Array<{ pair: [string, string]; structural: number; behavioral: number }> = [];

  for (const key of allPairs) {
    const [a, b] = key.split("\0") as [string, string];
    raw.push({
      pair: [a, b],
      structural: structuralMap.get(key) ?? 0,
      behavioral: behavioralMap.get(key) ?? 0,
    });
  }

  // ── Compute thresholds ──

  const sThreshold =
    options?.structural_threshold ?? median(raw.map((r) => r.structural).filter((v) => v > 0));
  const bThreshold =
    options?.behavioral_threshold ?? median(raw.map((r) => r.behavioral).filter((v) => v > 0));

  // ── Classify ──

  const entries: CouplingEntry[] = raw.map((r) => ({
    pair: r.pair,
    structural_weight: r.structural,
    behavioral_weight: r.behavioral,
    classification: classify(r.structural, r.behavioral, sThreshold, bThreshold),
  }));

  return {
    entries,
    structural_threshold: sThreshold,
    behavioral_threshold: bThreshold,
  };
}

/**
 * Extract hidden coupling entries, sorted by behavioral weight descending.
 */
export function findHiddenCoupling(matrix: CouplingMatrix): CouplingEntry[] {
  return matrix.entries
    .filter((e) => e.classification === "hidden_coupling")
    .sort((a, b) => b.behavioral_weight - a.behavioral_weight);
}

/**
 * Get coupling profile for a specific component.
 */
export function componentCouplingProfile(
  matrix: CouplingMatrix,
  component: string,
): CouplingEntry[] {
  return matrix.entries.filter((e) => e.pair[0] === component || e.pair[1] === component);
}
