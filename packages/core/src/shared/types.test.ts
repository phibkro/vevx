import { describe, test, expect } from "bun:test";

import { TaskDefinitionSchema, CodebaseGraphSchema } from "./types.js";

describe("TaskDefinitionSchema", () => {
  test("accepts valid TaskDefinition", () => {
    const result = TaskDefinitionSchema.parse({
      id: "1",
      touches: { writes: ["auth"], reads: ["shared"] },
      mutexes: ["db"],
    });
    expect(result.id).toBe("1");
    expect(result.touches.writes).toEqual(["auth"]);
    expect(result.mutexes).toEqual(["db"]);
  });

  test("strips execution fields from full Task", () => {
    const fullTask = {
      id: "1",
      description: "Implement auth",
      action: "implement",
      values: ["correctness"],
      touches: { writes: ["auth"] },
    };
    const result = TaskDefinitionSchema.parse(fullTask);
    expect(result).toEqual({
      id: "1",
      touches: { writes: ["auth"] },
    });
    expect("action" in result).toBe(false);
    expect("values" in result).toBe(false);
    expect("description" in result).toBe(false);
  });

  test("mutexes are optional", () => {
    const result = TaskDefinitionSchema.parse({
      id: "1",
      touches: { writes: ["auth"] },
    });
    expect(result.mutexes).toBeUndefined();
  });
});

describe("CodebaseGraphSchema", () => {
  test("accepts valid CodebaseGraph", () => {
    const graph = {
      manifest: { varp: "1.0", components: {} },
      coChange: { edges: [], total_commits_analyzed: 0, total_commits_filtered: 0 },
      imports: {
        import_deps: [],
        missing_deps: [],
        extra_deps: [],
        total_files_scanned: 0,
        total_imports_scanned: 0,
        components_with_source: [],
      },
    };
    const result = CodebaseGraphSchema.parse(graph);
    expect(result.manifest.varp).toBe("1.0");
    expect(result.coupling).toBeUndefined();
  });

  test("coupling is optional", () => {
    const graph = {
      manifest: { varp: "1.0", components: {} },
      coChange: { edges: [], total_commits_analyzed: 0, total_commits_filtered: 0 },
      imports: {
        import_deps: [],
        missing_deps: [],
        extra_deps: [],
        total_files_scanned: 0,
        total_imports_scanned: 0,
        components_with_source: [],
      },
      coupling: {
        entries: [],
        structural_threshold: 0.5,
        behavioral_threshold: 0.5,
      },
    };
    const result = CodebaseGraphSchema.parse(graph);
    expect(result.coupling).toBeDefined();
    expect(result.coupling!.entries).toEqual([]);
  });
});
