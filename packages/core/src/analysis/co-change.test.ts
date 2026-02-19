import { describe, expect, test } from "bun:test";
import { join } from "node:path";

import {
  analyzeCoChanges,
  computeCoChangeEdges,
  computeFileFrequencies,
  filterCommits,
  filterFiles,
  parseGitLog,
  scanCoChanges,
} from "./co-change.js";

// Helper: build synthetic git log output matching --pretty=format:"%H%n%s" --name-only
function makeLog(...commits: Array<{ sha: string; subject: string; files: string[] }>): string {
  return commits.map((c) => `${c.sha}\n${c.subject}\n\n${c.files.join("\n")}`).join("\n\n");
}

const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);
const SHA3 = "c".repeat(40);

describe("parseGitLog", () => {
  test("parses multiple commits", () => {
    const raw = makeLog(
      { sha: SHA1, subject: "feat: add feature", files: ["src/a.ts", "src/b.ts"] },
      { sha: SHA2, subject: "fix: bug", files: ["src/c.ts"] },
    );
    const commits = parseGitLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe(SHA1);
    expect(commits[0].subject).toBe("feat: add feature");
    expect(commits[0].files).toEqual(["src/a.ts", "src/b.ts"]);
    expect(commits[1].files).toEqual(["src/c.ts"]);
  });

  test("handles empty input", () => {
    expect(parseGitLog("")).toEqual([]);
    expect(parseGitLog("  ")).toEqual([]);
  });
});

describe("filterCommits", () => {
  const commits = [
    { sha: SHA1, subject: "feat: add feature", files: ["a.ts", "b.ts"] },
    { sha: SHA2, subject: "chore: update deps", files: ["package.json"] },
    {
      sha: SHA3,
      subject: "refactor: big rename",
      files: Array.from({ length: 60 }, (_, i) => `f${i}.ts`),
    },
  ];

  test("filters by message pattern", () => {
    const { kept, filtered } = filterCommits(commits, {
      max_commit_files: 50,
      skip_message_patterns: ["chore"],
      exclude_paths: [],
    });
    expect(kept).toHaveLength(1);
    expect(filtered).toBe(2); // chore + big commit
  });

  test("filters by size ceiling", () => {
    const { kept } = filterCommits(commits, {
      max_commit_files: 100,
      skip_message_patterns: [],
      exclude_paths: [],
    });
    expect(kept).toHaveLength(3);
  });
});

describe("filterFiles", () => {
  test("removes excluded file patterns", () => {
    const commits = [
      {
        sha: SHA1,
        subject: "test",
        files: ["src/a.ts", "bun.lock", "types.d.ts", ".varp/cache.json"],
      },
    ];
    const result = filterFiles(commits, ["**/bun.lock", "**/*.d.ts", "**/.varp/**"]);
    expect(result[0].files).toEqual(["src/a.ts"]);
  });
});

describe("computeCoChangeEdges", () => {
  test("computes pairwise edges with 1/(n-1) weighting", () => {
    const commits = [{ sha: SHA1, subject: "test", files: ["a.ts", "b.ts", "c.ts"] }];
    const edges = computeCoChangeEdges(commits);
    // 3 files → 3 pairs, each with weight 1/2
    expect(edges).toHaveLength(3);
    for (const edge of edges) {
      expect(edge.weight).toBeCloseTo(0.5);
      expect(edge.commit_count).toBe(1);
    }
  });

  test("accumulates weights across commits", () => {
    const commits = [
      { sha: SHA1, subject: "a", files: ["x.ts", "y.ts"] },
      { sha: SHA2, subject: "b", files: ["x.ts", "y.ts"] },
    ];
    const edges = computeCoChangeEdges(commits);
    expect(edges).toHaveLength(1);
    expect(edges[0].weight).toBeCloseTo(2.0); // 1 + 1
    expect(edges[0].commit_count).toBe(2);
  });

  test("sorts file pairs deterministically", () => {
    const commits = [{ sha: SHA1, subject: "a", files: ["z.ts", "a.ts"] }];
    const edges = computeCoChangeEdges(commits);
    expect(edges[0].files[0]).toBe("a.ts");
    expect(edges[0].files[1]).toBe("z.ts");
  });

  test("skips single-file commits", () => {
    const commits = [{ sha: SHA1, subject: "a", files: ["x.ts"] }];
    expect(computeCoChangeEdges(commits)).toEqual([]);
  });
});

describe("computeFileFrequencies", () => {
  test("counts per-file occurrences across commits", () => {
    const commits = [
      { sha: SHA1, subject: "x", files: ["a.ts", "b.ts"] },
      { sha: SHA2, subject: "y", files: ["a.ts", "c.ts"] },
    ];
    const freq = computeFileFrequencies(commits);
    expect(freq["a.ts"]).toBe(2);
    expect(freq["b.ts"]).toBe(1);
    expect(freq["c.ts"]).toBe(1);
  });
});

describe("analyzeCoChanges", () => {
  test("full pipeline with defaults", () => {
    const raw = makeLog(
      { sha: SHA1, subject: "feat: add feature", files: ["src/a.ts", "src/b.ts"] },
      { sha: SHA2, subject: "chore: deps", files: ["package.json"] },
    );
    const result = analyzeCoChanges(raw);
    expect(result.total_commits_analyzed).toBe(2);
    expect(result.total_commits_filtered).toBe(1); // chore filtered
    expect(result.edges).toHaveLength(1);
    expect(result.last_sha).toBe(SHA1);
    expect(result.file_frequencies).toBeDefined();
    expect(result.file_frequencies!["src/a.ts"]).toBe(1);
  });
});

describe("scanCoChanges", () => {
  // Integration test with real git repo
  async function withTempGitRepo(fn: (dir: string) => void): Promise<void> {
    const dir = join("/tmp/claude", `co-change-test-${Date.now()}`);
    const run = (cmd: string[]) => {
      const r = Bun.spawnSync(cmd, { cwd: dir, stdout: "pipe", stderr: "pipe" });
      if (!r.success) throw new Error(`${cmd.join(" ")} failed: ${r.stderr.toString()}`);
    };
    const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
    try {
      mkdirSync(dir, { recursive: true });
      run(["git", "init"]);
      run(["git", "config", "user.email", "test@test.com"]);
      run(["git", "config", "user.name", "Test"]);

      // Commit 1: two files
      writeFileSync(join(dir, "a.ts"), "export const a = 1;");
      writeFileSync(join(dir, "b.ts"), "export const b = 2;");
      run(["git", "add", "."]);
      run(["git", "commit", "-m", "feat: initial"]);

      // Commit 2: modify both
      writeFileSync(join(dir, "a.ts"), "export const a = 2;");
      writeFileSync(join(dir, "b.ts"), "export const b = 3;");
      run(["git", "add", "."]);
      run(["git", "commit", "-m", "feat: update both"]);

      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("scans real git repo", async () => {
    await withTempGitRepo((dir) => {
      const graph = scanCoChanges(dir);
      expect(graph.total_commits_analyzed).toBeGreaterThanOrEqual(1);
      expect(graph.edges.length).toBeGreaterThanOrEqual(1);
      expect(graph.last_sha).toMatch(/^[0-9a-f]{40}$/);
    });
  });
});
