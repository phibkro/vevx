import { describe, expect, test } from "bun:test";

import type { CoChangeEdge, ImportScanResult } from "#shared/types.js";

import { computeHotspots, fileNeighborhood } from "./hotspots.js";

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
