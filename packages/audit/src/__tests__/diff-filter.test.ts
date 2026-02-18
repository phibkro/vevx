import { describe, expect, it } from "bun:test";

import type { FileContent } from "../agents/types";
import { filterToChanged, expandWithDependents } from "../planner/diff-filter";

// ── filterToChanged ──

describe("filterToChanged", () => {
  const makeFile = (relativePath: string): FileContent => ({
    path: `/project/${relativePath}`,
    relativePath,
    language: "typescript",
    content: "// code",
    size: 100,
  });

  it("filters files to only those in the changed list", () => {
    const files = [
      makeFile("src/api/routes.ts"),
      makeFile("src/db/query.ts"),
      makeFile("src/utils/helpers.ts"),
    ];

    const changed = ["src/api/routes.ts", "src/db/query.ts"];
    const filtered = filterToChanged(files, changed);

    expect(filtered).toHaveLength(2);
    expect(filtered.map((f) => f.relativePath)).toEqual(["src/api/routes.ts", "src/db/query.ts"]);
  });

  it("returns empty when no files match", () => {
    const files = [makeFile("src/api/routes.ts")];
    expect(filterToChanged(files, ["other.ts"])).toEqual([]);
  });

  it("returns empty when changed list is empty", () => {
    const files = [makeFile("src/api/routes.ts")];
    expect(filterToChanged(files, [])).toEqual([]);
  });
});

// ── expandWithDependents ──

describe("expandWithDependents", () => {
  const components = {
    api: { path: "/project/src/api", deps: ["db", "utils"] },
    db: { path: "/project/src/db", deps: ["utils"] },
    utils: { path: "/project/src/utils" },
    frontend: { path: "/project/src/frontend", deps: ["api"] },
  };

  const fileMap = new Map([
    ["api", ["src/api/routes.ts", "src/api/auth.ts"]],
    ["db", ["src/db/query.ts"]],
    ["utils", ["src/utils/helpers.ts"]],
    ["frontend", ["src/frontend/app.ts"]],
  ]);

  it("returns original paths when no manifest components match", () => {
    const result = expandWithDependents(["random/file.ts"], components, fileMap);
    expect(result).toEqual(["random/file.ts"]);
  });

  it("includes files from components that depend on changed components", () => {
    // utils changed → db depends on utils, api depends on utils, frontend depends on api
    const result = expandWithDependents(["utils/helpers.ts"], components, fileMap);

    // Original changed file always included
    expect(result).toContain("utils/helpers.ts");
    // Direct dependents: db and api depend on utils
    expect(result).toContain("src/db/query.ts");
    expect(result).toContain("src/api/routes.ts");
    expect(result).toContain("src/api/auth.ts");
    // Transitive: frontend depends on api, which depends on utils
    expect(result).toContain("src/frontend/app.ts");
    // utils' own files
    expect(result).toContain("src/utils/helpers.ts");
  });

  it("expands only direct dependents when leaf component changes", () => {
    // frontend has no reverse deps — nothing depends on it
    const result = expandWithDependents(["frontend/app.ts"], components, fileMap);

    expect(result).toContain("frontend/app.ts");
    expect(result).toContain("src/frontend/app.ts");
    // Should NOT include other components
    expect(result).not.toContain("src/api/routes.ts");
    expect(result).not.toContain("src/db/query.ts");
    expect(result).not.toContain("src/utils/helpers.ts");
  });

  it("handles cycles in dependency graph", () => {
    const cyclicComponents = {
      a: { path: "/project/src/a", deps: ["b"] },
      b: { path: "/project/src/b", deps: ["a"] },
    };
    const cyclicFileMap = new Map([
      ["a", ["src/a/index.ts"]],
      ["b", ["src/b/index.ts"]],
    ]);

    // Changing a should include b (depends on a) and a (depends on b) — no infinite loop
    const result = expandWithDependents(["a/index.ts"], cyclicComponents, cyclicFileMap);

    expect(result).toContain("a/index.ts");
    expect(result).toContain("src/a/index.ts");
    expect(result).toContain("src/b/index.ts");
  });

  it("handles multi-level transitive expansion", () => {
    // Chain: d → c → b → a
    const chainComponents = {
      a: { path: "/project/src/a" },
      b: { path: "/project/src/b", deps: ["a"] },
      c: { path: "/project/src/c", deps: ["b"] },
      d: { path: "/project/src/d", deps: ["c"] },
    };
    const chainFileMap = new Map([
      ["a", ["src/a/index.ts"]],
      ["b", ["src/b/index.ts"]],
      ["c", ["src/c/index.ts"]],
      ["d", ["src/d/index.ts"]],
    ]);

    // Changing a should cascade through b → c → d
    const result = expandWithDependents(["a/index.ts"], chainComponents, chainFileMap);

    expect(result).toContain("src/a/index.ts");
    expect(result).toContain("src/b/index.ts");
    expect(result).toContain("src/c/index.ts");
    expect(result).toContain("src/d/index.ts");
  });

  it("handles multi-path components", () => {
    const multiPathComponents = {
      auth: {
        path: ["/project/src/controllers/auth", "/project/src/services/auth"],
        deps: ["db"],
      },
      db: { path: "/project/src/db" },
    };
    const multiPathFileMap = new Map([
      ["auth", ["src/controllers/auth/login.ts", "src/services/auth/jwt.ts"]],
      ["db", ["src/db/query.ts"]],
    ]);

    // Changing db should include auth (depends on db)
    const result = expandWithDependents(["db/query.ts"], multiPathComponents, multiPathFileMap);

    expect(result).toContain("src/controllers/auth/login.ts");
    expect(result).toContain("src/services/auth/jwt.ts");
    expect(result).toContain("src/db/query.ts");
  });

  it("includes changed files even when no components match", () => {
    const result = expandWithDependents(["random/file.ts", "another/file.ts"], components, fileMap);
    expect(result).toEqual(["random/file.ts", "another/file.ts"]);
  });

  it("deduplicates expanded paths", () => {
    // Change multiple files in utils — dependents should appear once
    const result = expandWithDependents(
      ["utils/helpers.ts", "utils/format.ts"],
      components,
      fileMap,
    );

    const occurrences = result.filter((p) => p === "src/db/query.ts");
    expect(occurrences).toHaveLength(1);
  });
});
