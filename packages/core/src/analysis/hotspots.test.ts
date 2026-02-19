import { describe, expect, test } from "bun:test";

import type { CoChangeEdge, ImportScanResult } from "#shared/types.js";

import {
  computeComplexityTrendsFromStats,
  computeHotspots,
  fileNeighborhood,
  parseNumstatLog,
} from "./hotspots.js";

describe("computeHotspots", () => {
  test("scores files by frequency x line count, sorted descending", () => {
    const freq = { "a.ts": 10, "b.ts": 5, "c.ts": 20 };
    const lines = { "a.ts": 100, "b.ts": 500, "c.ts": 10 };
    const result = computeHotspots(freq, lines);

    expect(result[0].file).toBe("b.ts"); // 5 * 500 = 2500
    expect(result[0].score).toBe(2500);
    expect(result[1].file).toBe("a.ts"); // 10 * 100 = 1000
    expect(result[1].score).toBe(1000);
    expect(result[2].file).toBe("c.ts"); // 20 * 10 = 200
    expect(result[2].score).toBe(200);
  });

  test("skips files with zero or missing line count", () => {
    const freq = { "a.ts": 10, "deleted.ts": 5 };
    const lines = { "a.ts": 100 };
    const result = computeHotspots(freq, lines);
    expect(result).toHaveLength(1);
    expect(result[0].file).toBe("a.ts");
  });
});

const emptyImports: ImportScanResult = {
  import_deps: [],
  missing_deps: [],
  extra_deps: [],
  total_files_scanned: 0,
  total_imports_scanned: 0,
  components_with_source: [],
};

describe("fileNeighborhood", () => {
  test("finds co-change neighbors sorted by weight", () => {
    const edges: CoChangeEdge[] = [
      { files: ["a.ts", "b.ts"], weight: 1.5, commit_count: 3 },
      { files: ["a.ts", "c.ts"], weight: 0.5, commit_count: 1 },
      { files: ["b.ts", "c.ts"], weight: 2.0, commit_count: 4 },
    ];

    const result = fileNeighborhood("a.ts", edges, emptyImports);
    expect(result).toHaveLength(2);
    expect(result[0].file).toBe("b.ts");
    expect(result[0].coChangeWeight).toBe(1.5);
    expect(result[0].coChangeCommits).toBe(3);
    expect(result[1].file).toBe("c.ts");
  });

  test("returns empty for file with no edges", () => {
    const edges: CoChangeEdge[] = [{ files: ["b.ts", "c.ts"], weight: 1.0, commit_count: 1 }];
    const result = fileNeighborhood("a.ts", edges, emptyImports);
    expect(result).toHaveLength(0);
  });

  test("annotates import relationships", () => {
    const edges: CoChangeEdge[] = [{ files: ["a.ts", "b.ts"], weight: 1.0, commit_count: 1 }];
    const imports: ImportScanResult = {
      ...emptyImports,
      import_deps: [
        {
          from: "comp-a",
          to: "comp-b",
          evidence: [{ source_file: "a.ts", import_specifier: "b.ts" }],
        },
      ],
    };
    const result = fileNeighborhood("a.ts", edges, imports);
    expect(result[0].hasImportRelation).toBe(true);
  });
});

// Helper: build synthetic git log --numstat output
const SHA1 = "a".repeat(40);
const SHA2 = "b".repeat(40);
const SHA3 = "c".repeat(40);
const SHA4 = "d".repeat(40);

function makeNumstatLog(
  ...commits: Array<{ sha: string; subject: string; files: Array<[number, number, string]> }>
): string {
  return commits
    .map((c) => {
      const stats = c.files.map(([add, del, file]) => `${add}\t${del}\t${file}`).join("\n");
      return `${c.sha}\n${c.subject}\n\n${stats}`;
    })
    .join("\n\n");
}

describe("parseNumstatLog", () => {
  test("parses multiple commits with numstat entries", () => {
    const raw = makeNumstatLog(
      {
        sha: SHA1,
        subject: "feat: add",
        files: [
          [10, 2, "src/a.ts"],
          [5, 0, "src/b.ts"],
        ],
      },
      { sha: SHA2, subject: "fix: bug", files: [[3, 1, "src/a.ts"]] },
    );
    const commits = parseNumstatLog(raw);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe(SHA1);
    expect(commits[0].files).toHaveLength(2);
    expect(commits[0].files[0]).toEqual({ file: "src/a.ts", additions: 10, deletions: 2 });
    expect(commits[1].files[0]).toEqual({ file: "src/a.ts", additions: 3, deletions: 1 });
  });

  test("skips binary files with dash stats", () => {
    const raw = `${SHA1}\nfeat: add image\n\n-\t-\tlogo.png\n5\t0\tREADME.md`;
    const commits = parseNumstatLog(raw);
    expect(commits[0].files).toHaveLength(1);
    expect(commits[0].files[0].file).toBe("README.md");
  });

  test("handles empty input", () => {
    expect(parseNumstatLog("")).toEqual([]);
  });
});

describe("computeComplexityTrendsFromStats", () => {
  test("detects increasing trend when second half has higher net additions", () => {
    // Chronological: oldest first in git log = last in array
    // Git log newest-first: SHA4 (newest), SHA3, SHA2, SHA1 (oldest)
    const commits = [
      { sha: SHA4, files: [{ file: "a.ts", additions: 20, deletions: 0 }] },
      { sha: SHA3, files: [{ file: "a.ts", additions: 15, deletions: 0 }] },
      { sha: SHA2, files: [{ file: "a.ts", additions: 2, deletions: 1 }] },
      { sha: SHA1, files: [{ file: "a.ts", additions: 3, deletions: 2 }] },
    ];
    const result = computeComplexityTrendsFromStats(commits, ["a.ts"]);
    expect(result["a.ts"].direction).toBe("increasing");
    expect(result["a.ts"].magnitude).toBeGreaterThan(0);
  });

  test("detects decreasing trend when second half has net deletions", () => {
    const commits = [
      { sha: SHA4, files: [{ file: "a.ts", additions: 0, deletions: 10 }] },
      { sha: SHA3, files: [{ file: "a.ts", additions: 0, deletions: 8 }] },
      { sha: SHA2, files: [{ file: "a.ts", additions: 10, deletions: 0 }] },
      { sha: SHA1, files: [{ file: "a.ts", additions: 8, deletions: 0 }] },
    ];
    const result = computeComplexityTrendsFromStats(commits, ["a.ts"]);
    expect(result["a.ts"].direction).toBe("decreasing");
  });

  test("reports stable when changes are minimal", () => {
    const commits = [
      { sha: SHA2, files: [{ file: "a.ts", additions: 1, deletions: 1 }] },
      { sha: SHA1, files: [{ file: "a.ts", additions: 1, deletions: 1 }] },
    ];
    const result = computeComplexityTrendsFromStats(commits, ["a.ts"]);
    expect(result["a.ts"].direction).toBe("stable");
  });

  test("reports stable for files with fewer than 2 commits", () => {
    const commits = [{ sha: SHA1, files: [{ file: "a.ts", additions: 50, deletions: 0 }] }];
    const result = computeComplexityTrendsFromStats(commits, ["a.ts"]);
    expect(result["a.ts"].direction).toBe("stable");
    expect(result["a.ts"].magnitude).toBe(0);
  });

  test("only includes requested files", () => {
    const commits = [
      {
        sha: SHA2,
        files: [
          { file: "a.ts", additions: 10, deletions: 0 },
          { file: "b.ts", additions: 5, deletions: 0 },
        ],
      },
      { sha: SHA1, files: [{ file: "a.ts", additions: 1, deletions: 0 }] },
    ];
    const result = computeComplexityTrendsFromStats(commits, ["a.ts"]);
    expect(result["a.ts"]).toBeDefined();
    expect(result["b.ts"]).toBeUndefined();
  });
});
