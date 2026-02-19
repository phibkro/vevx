import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CoChangeEdge, ImportScanResult } from "#shared/types.js";

// ── Hotspot scoring ──

export interface HotspotEntry {
  file: string;
  changeFrequency: number;
  lineCount: number;
  score: number;
}

/**
 * Compute hotspot scores: change frequency x lines of code.
 * Files that are both complex and frequently modified are where bugs live.
 */
export function computeHotspots(
  fileFrequencies: Record<string, number>,
  lineCounts: Record<string, number>,
): HotspotEntry[] {
  const entries: HotspotEntry[] = [];

  for (const [file, changeFrequency] of Object.entries(fileFrequencies)) {
    const lineCount = lineCounts[file] ?? 0;
    if (lineCount === 0) continue;
    entries.push({
      file,
      changeFrequency,
      lineCount,
      score: changeFrequency * lineCount,
    });
  }

  return entries.sort((a, b) => b.score - a.score);
}

/**
 * Count lines in files. Reads from filesystem.
 */
export function countLines(filePaths: string[], repoDir: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const file of filePaths) {
    try {
      const content = readFileSync(join(repoDir, file), "utf-8");
      counts[file] = content.split("\n").length;
    } catch {
      // File doesn't exist (deleted), skip
    }
  }
  return counts;
}

// ── Per-file neighborhood ──

export interface FileNeighbor {
  file: string;
  coChangeWeight: number;
  coChangeCommits: number;
  hasImportRelation: boolean;
}

/**
 * Find files that co-change with a given file, annotated with import relationship.
 */
export function fileNeighborhood(
  file: string,
  edges: CoChangeEdge[],
  imports: ImportScanResult,
): FileNeighbor[] {
  // Build set of files with import relationships to target
  const importRelated = new Set<string>();
  for (const dep of imports.import_deps) {
    for (const ev of dep.evidence) {
      if (ev.source_file === file || ev.import_specifier.includes(file)) {
        importRelated.add(ev.source_file);
        importRelated.add(ev.import_specifier);
      }
    }
  }

  const neighbors: FileNeighbor[] = [];
  for (const edge of edges) {
    const [a, b] = edge.files;
    if (a !== file && b !== file) continue;
    const neighbor = a === file ? b : a;
    neighbors.push({
      file: neighbor,
      coChangeWeight: edge.weight,
      coChangeCommits: edge.commit_count,
      hasImportRelation: importRelated.has(neighbor),
    });
  }

  return neighbors.sort((a, b) => b.coChangeWeight - a.coChangeWeight);
}
