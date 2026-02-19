import type { CoChangeEdge, CoChangeGraph, FilterConfig } from "#shared/types.js";
import { FilterConfigSchema } from "#shared/types.js";

// ── Internal types (not exported) ──

interface Commit {
  sha: string;
  subject: string;
  files: string[];
}

// ── Pure functions ──

/**
 * Parse raw `git log --pretty=format:"%H%n%s" --name-only` output into commits.
 * Each commit block: SHA line, subject line, blank line, file lines, blank line.
 */
export function parseGitLog(raw: string): Commit[] {
  const commits: Commit[] = [];
  const blocks = raw.split("\n\n");

  let i = 0;
  while (i < blocks.length) {
    const header = blocks[i]?.trim();
    if (!header) {
      i++;
      continue;
    }

    const lines = header.split("\n");
    // First block of a commit has SHA + subject as last two lines of previous block's trailing
    // Actually: format is SHA\nsubject\n\nfile1\nfile2\n\nSHA\nsubject\n\nfile1...
    // So blocks alternate between header (SHA\nsubject) and files
    if (lines.length >= 2 && /^[0-9a-f]{40}$/.test(lines[0])) {
      const sha = lines[0];
      const subject = lines[1];
      const fileBlock = blocks[i + 1]?.trim();
      const files = fileBlock ? fileBlock.split("\n").filter((f) => f.length > 0) : [];
      commits.push({ sha, subject, files });
      i += 2;
    } else {
      i++;
    }
  }

  return commits;
}

/**
 * Filter commits by size ceiling and message patterns.
 */
export function filterCommits(
  commits: Commit[],
  config: FilterConfig,
): { kept: Commit[]; filtered: number } {
  let filtered = 0;
  const kept: Commit[] = [];
  const patterns = config.skip_message_patterns.map((p) => p.toLowerCase());

  for (const commit of commits) {
    // Size ceiling: skip commits touching too many files
    if (commit.files.length > config.max_commit_files) {
      filtered++;
      continue;
    }

    // Message pattern filter
    const subjectLower = commit.subject.toLowerCase();
    if (patterns.some((p) => subjectLower.includes(p))) {
      filtered++;
      continue;
    }

    kept.push(commit);
  }

  return { kept, filtered };
}

/**
 * Filter out excluded file paths from each commit using glob-like matching.
 * Supports ** and * wildcards.
 */
export function filterFiles(commits: Commit[], excludePatterns: string[]): Commit[] {
  const regexes = excludePatterns.map((p) => {
    // Replace **/ at start with optional prefix match (zero or more segments)
    const escaped = p
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "(?:.*/)?")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]*");
    return new RegExp(`^${escaped}$`);
  });

  return commits.map((c) => ({
    ...c,
    files: c.files.filter((f) => !regexes.some((r) => r.test(f))),
  }));
}

/**
 * Compute co-change edges from filtered commits.
 * Each pair of files in a commit gets weight 1/(n-1) where n = file count.
 */
export function computeCoChangeEdges(commits: Commit[]): CoChangeEdge[] {
  const edgeMap = new Map<string, { weight: number; count: number }>();

  for (const commit of commits) {
    const files = commit.files;
    if (files.length < 2) continue;

    const w = 1 / (files.length - 1);

    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const [a, b] = files[i] < files[j] ? [files[i], files[j]] : [files[j], files[i]];
        const key = `${a}\0${b}`;
        const existing = edgeMap.get(key);
        if (existing) {
          existing.weight += w;
          existing.count++;
        } else {
          edgeMap.set(key, { weight: w, count: 1 });
        }
      }
    }
  }

  return Array.from(edgeMap.entries()).map(([key, { weight, count }]) => {
    const [a, b] = key.split("\0") as [string, string];
    return { files: [a, b], weight, commit_count: count };
  });
}

/**
 * Full pure pipeline: parse → filter commits → filter files → compute edges.
 */
export function analyzeCoChanges(raw: string, config?: Partial<FilterConfig>): CoChangeGraph {
  const resolvedConfig = FilterConfigSchema.parse(config ?? {});
  const commits = parseGitLog(raw);
  const { kept, filtered } = filterCommits(commits, resolvedConfig);
  const cleaned = filterFiles(kept, resolvedConfig.exclude_paths);
  const edges = computeCoChangeEdges(cleaned);
  const lastSha = commits[0]?.sha;

  return {
    edges,
    total_commits_analyzed: commits.length,
    total_commits_filtered: filtered,
    ...(lastSha ? { last_sha: lastSha } : {}),
  };
}

// ── Effectful wrapper ──

/**
 * Run git log and analyze co-changes. Uses Bun.spawnSync.
 * Optional lastSha for incremental: only analyzes commits since lastSha.
 */
export function scanCoChanges(
  repoDir: string,
  config?: Partial<FilterConfig>,
  lastSha?: string,
): CoChangeGraph {
  const range = lastSha ? `${lastSha}..HEAD` : undefined;
  const args = [
    "log",
    "--pretty=format:%H%n%s",
    "--name-only",
    "--diff-filter=ACMRD",
    ...(range ? [range] : []),
  ];

  const result = Bun.spawnSync(["git", ...args], {
    cwd: repoDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  if (!result.success) {
    const stderr = result.stderr.toString().trim();
    throw new Error(`git log failed: ${stderr}`);
  }

  return analyzeCoChanges(result.stdout.toString(), config);
}
