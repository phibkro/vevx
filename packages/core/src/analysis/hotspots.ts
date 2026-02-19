import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CoChangeEdge, ImportScanResult } from "#shared/types.js";

// ── Hotspot scoring ──

export type TrendDirection = "increasing" | "decreasing" | "stable";

export interface TrendInfo {
  direction: TrendDirection;
  magnitude: number;
}

export interface HotspotEntry {
  file: string;
  changeFrequency: number;
  lineCount: number;
  score: number;
  trend?: TrendInfo;
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

// ── Complexity trend ──

export interface NumstatEntry {
  file: string;
  additions: number;
  deletions: number;
}

/**
 * Parse git log --numstat output into per-commit file stats.
 * Format: SHA\nsubject\n\nadd\tdel\tfile\nadd\tdel\tfile\n\nSHA\n...
 */
export function parseNumstatLog(raw: string): Array<{ sha: string; files: NumstatEntry[] }> {
  const commits: Array<{ sha: string; files: NumstatEntry[] }> = [];
  const blocks = raw.split("\n\n");

  let i = 0;
  while (i < blocks.length) {
    const header = blocks[i]?.trim();
    if (!header) {
      i++;
      continue;
    }

    const lines = header.split("\n");
    if (lines.length >= 2 && /^[0-9a-f]{40}$/.test(lines[0])) {
      const sha = lines[0];
      const statsBlock = blocks[i + 1]?.trim();
      const files: NumstatEntry[] = [];

      if (statsBlock) {
        for (const line of statsBlock.split("\n")) {
          const parts = line.split("\t");
          if (parts.length >= 3) {
            const additions = parseInt(parts[0], 10);
            const deletions = parseInt(parts[1], 10);
            // Binary files show "-" for additions/deletions
            if (isNaN(additions) || isNaN(deletions)) continue;
            files.push({ file: parts[2], additions, deletions });
          }
        }
      }

      commits.push({ sha, files });
      i += 2;
    } else {
      i++;
    }
  }

  return commits;
}

/**
 * Compute complexity trend direction for each file by comparing
 * average net LOC change in the first half of history vs the second half.
 *
 * Pure function: operates on parsed numstat data, no I/O.
 */
export function computeComplexityTrendsFromStats(
  commits: Array<{ sha: string; files: NumstatEntry[] }>,
  filePaths: string[],
): Record<string, TrendInfo> {
  // Collect per-file net changes in chronological order (commits are newest-first from git log)
  const fileChanges = new Map<string, number[]>();
  const fileSet = new Set(filePaths);

  // Reverse to get chronological order (oldest first)
  for (let i = commits.length - 1; i >= 0; i--) {
    for (const entry of commits[i].files) {
      if (!fileSet.has(entry.file)) continue;
      const changes = fileChanges.get(entry.file) ?? [];
      changes.push(entry.additions - entry.deletions);
      fileChanges.set(entry.file, changes);
    }
  }

  const result: Record<string, TrendInfo> = {};

  for (const file of filePaths) {
    const changes = fileChanges.get(file);
    if (!changes || changes.length < 2) {
      result[file] = { direction: "stable", magnitude: 0 };
      continue;
    }

    const mid = Math.floor(changes.length / 2);
    const firstHalf = changes.slice(0, mid);
    const secondHalf = changes.slice(mid);

    const avgFirst = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    const diff = avgSecond - avgFirst;

    // Threshold: consider stable if difference is less than 1 line on average
    const magnitude = Math.abs(diff);
    let direction: TrendDirection;
    if (magnitude < 1) {
      direction = "stable";
    } else if (diff > 0) {
      direction = "increasing";
    } else {
      direction = "decreasing";
    }

    result[file] = { direction, magnitude: Math.round(magnitude * 100) / 100 };
  }

  return result;
}

/**
 * Compute complexity trends from git history. Uses Bun.spawnSync for git calls.
 */
export function computeComplexityTrends(
  repoDir: string,
  filePaths: string[],
  options?: { maxCommits?: number },
): Record<string, TrendInfo> {
  if (filePaths.length === 0) return {};

  const maxCommits = options?.maxCommits ?? 500;
  const args = [
    "log",
    "--pretty=format:%H%n%s",
    "--numstat",
    `-n${maxCommits}`,
    "--diff-filter=ACMRD",
    "--",
    ...filePaths,
  ];

  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git log --numstat failed: ${stderr}`);
  }

  const commits = parseNumstatLog(result.stdout.toString());
  return computeComplexityTrendsFromStats(commits, filePaths);
}
