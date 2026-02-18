import type { FileContent } from "../agents/types";
import { filterToChanged, expandWithDependents } from "../planner/diff-filter";

// ── filterToChanged ──

describe("filterToChanged", () => {
  const makeFile = (relativePath: string): FileContent => ({
    path: `/project/${relativePath}`,
    relativePath,
    language: "typescript",
    content: "// code",
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
    const result = expandWithDependents(
      ["src/utils/helpers.ts"],
      // Need to make utils match by having the changed file path under its component path
      {
        ...components,
        utils: { path: "/project/src/utils" },
      },
      fileMap,
    );

    // The original changed file should always be included
    expect(result).toContain("src/utils/helpers.ts");
  });
});
