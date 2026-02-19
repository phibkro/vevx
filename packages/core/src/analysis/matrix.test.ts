import { describe, expect, test } from "bun:test";

import type { CoChangeGraph, ImportScanResult, Manifest } from "#shared/types.js";

import { buildCouplingMatrix, componentCouplingProfile, findHiddenCoupling } from "./matrix.js";

// Minimal manifest with three components
const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/repo/src/auth", docs: [] },
    db: { path: "/repo/src/db", docs: [] },
    api: { path: "/repo/src/api", docs: [] },
  },
};

// Co-change: auth↔db frequent, api↔db infrequent
const coChange: CoChangeGraph = {
  edges: [
    { files: ["src/auth/login.ts", "src/db/users.ts"], weight: 5.0, commit_count: 10 },
    { files: ["src/api/routes.ts", "src/db/query.ts"], weight: 0.5, commit_count: 1 },
  ],
  total_commits_analyzed: 50,
  total_commits_filtered: 5,
};

// Imports: api→db declared, auth→db not declared (hidden)
const imports: ImportScanResult = {
  import_deps: [
    {
      from: "api",
      to: "db",
      evidence: [
        { source_file: "/repo/src/api/routes.ts", import_specifier: "../db/query.js" },
        { source_file: "/repo/src/api/handler.ts", import_specifier: "../db/query.js" },
        { source_file: "/repo/src/api/middleware.ts", import_specifier: "../db/connection.js" },
      ],
    },
  ],
  missing_deps: [],
  extra_deps: [],
  total_files_scanned: 10,
  total_imports_scanned: 20,
  components_with_source: ["auth", "db", "api"],
};

describe("buildCouplingMatrix", () => {
  test("classifies hidden coupling (high behavioral, no structural)", () => {
    const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: "/repo" });

    const authDb = matrix.entries.find((e) => e.pair.includes("auth") && e.pair.includes("db"));
    expect(authDb).toBeDefined();
    expect(authDb!.behavioral_weight).toBeGreaterThan(0);
    expect(authDb!.structural_weight).toBe(0);
    expect(authDb!.classification).toBe("hidden_coupling");
  });

  test("classifies explicit module (high both)", () => {
    // api↔db has both structural (3 imports) and behavioral (0.5 co-change)
    // With manual thresholds set low, both should be above
    const matrix = buildCouplingMatrix(coChange, imports, manifest, {
      repo_dir: "/repo",
      structural_threshold: 1,
      behavioral_threshold: 0.1,
    });

    const apiDb = matrix.entries.find((e) => e.pair.includes("api") && e.pair.includes("db"));
    expect(apiDb).toBeDefined();
    expect(apiDb!.classification).toBe("explicit_module");
  });

  test("classifies stable interface (high structural, low behavioral)", () => {
    // No co-change for auth↔api, but add imports
    const importsWithExtra: ImportScanResult = {
      ...imports,
      import_deps: [
        ...imports.import_deps,
        {
          from: "auth",
          to: "api",
          evidence: [
            { source_file: "/repo/src/auth/client.ts", import_specifier: "../api/types.js" },
            { source_file: "/repo/src/auth/sso.ts", import_specifier: "../api/types.js" },
          ],
        },
      ],
    };

    const matrix = buildCouplingMatrix(coChange, importsWithExtra, manifest, {
      repo_dir: "/repo",
      structural_threshold: 1,
      behavioral_threshold: 1,
    });

    const authApi = matrix.entries.find((e) => e.pair.includes("auth") && e.pair.includes("api"));
    expect(authApi).toBeDefined();
    expect(authApi!.classification).toBe("stable_interface");
  });

  test("uses median thresholds by default", () => {
    const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: "/repo" });
    expect(matrix.structural_threshold).toBeGreaterThan(0);
    expect(matrix.behavioral_threshold).toBeGreaterThan(0);
  });
});

describe("findHiddenCoupling", () => {
  test("returns only hidden coupling entries sorted by behavioral weight", () => {
    const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: "/repo" });
    const hidden = findHiddenCoupling(matrix);

    for (const entry of hidden) {
      expect(entry.classification).toBe("hidden_coupling");
    }

    // Sorted descending by behavioral weight
    for (let i = 1; i < hidden.length; i++) {
      expect(hidden[i - 1].behavioral_weight).toBeGreaterThanOrEqual(hidden[i].behavioral_weight);
    }
  });
});

describe("componentCouplingProfile", () => {
  test("returns all entries involving a component", () => {
    const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: "/repo" });
    const dbProfile = componentCouplingProfile(matrix, "db");
    expect(dbProfile.length).toBeGreaterThan(0);
    for (const entry of dbProfile) {
      expect(entry.pair.includes("db")).toBe(true);
    }
  });

  test("returns empty for unknown component", () => {
    const matrix = buildCouplingMatrix(coChange, imports, manifest, { repo_dir: "/repo" });
    expect(componentCouplingProfile(matrix, "nonexistent")).toEqual([]);
  });
});
