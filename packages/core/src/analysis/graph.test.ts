import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";

import { buildCodebaseGraph } from "./graph.js";

const PROJECT_ROOT = resolve(import.meta.dir, "../../../..");

describe("buildCodebaseGraph", () => {
  test("assembles graph from manifest", () => {
    const graph = buildCodebaseGraph(resolve(PROJECT_ROOT, "varp.yaml"));
    expect(graph.manifest.varp).toBeDefined();
    expect(graph.coChange.edges).toBeInstanceOf(Array);
    expect(graph.imports.import_deps).toBeInstanceOf(Array);
    expect(graph.coupling).toBeUndefined();
  });

  test("includes coupling when requested", () => {
    const graph = buildCodebaseGraph(resolve(PROJECT_ROOT, "varp.yaml"), {
      withCoupling: true,
    });
    expect(graph.coupling).toBeDefined();
    expect(graph.coupling!.entries).toBeInstanceOf(Array);
  });
});
