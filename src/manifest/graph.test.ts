import { describe, test, expect } from "bun:test";
import { invalidationCascade, validateDependencyGraph } from "./graph.js";
import type { Manifest } from "../types.js";

function makeManifest(
  components: Record<string, { depends_on?: string[] }>,
): Manifest {
  const result: Manifest = {
    varp: "0.1.0",
    name: "test",
    components: {},
  };
  for (const [name, config] of Object.entries(components)) {
    result.components[name] = {
      path: `./src/${name}`,
      depends_on: config.depends_on,
      docs: {
        interface: `./docs/${name}/interface.md`,
        internal: `./docs/${name}/internal.md`,
      },
    };
  }
  return result;
}

describe("invalidationCascade", () => {
  test("returns changed component when no dependents", () => {
    const manifest = makeManifest({ auth: {} });
    expect(invalidationCascade(manifest, ["auth"])).toEqual(["auth"]);
  });

  test("cascades through direct dependents", () => {
    const manifest = makeManifest({
      auth: {},
      api: { depends_on: ["auth"] },
      web: { depends_on: ["api"] },
    });

    const result = invalidationCascade(manifest, ["auth"]);
    expect(result).toContain("auth");
    expect(result).toContain("api");
    expect(result).toContain("web");
  });

  test("handles diamond dependencies", () => {
    const manifest = makeManifest({
      core: {},
      auth: { depends_on: ["core"] },
      api: { depends_on: ["core"] },
      web: { depends_on: ["auth", "api"] },
    });

    const result = invalidationCascade(manifest, ["core"]);
    expect(result.sort()).toEqual(["api", "auth", "core", "web"]);
  });

  test("handles multiple changed components", () => {
    const manifest = makeManifest({
      auth: {},
      api: { depends_on: ["auth"] },
      db: {},
      cache: { depends_on: ["db"] },
    });

    const result = invalidationCascade(manifest, ["auth", "db"]);
    expect(result.sort()).toEqual(["api", "auth", "cache", "db"]);
  });
});

describe("validateDependencyGraph", () => {
  test("valid acyclic graph", () => {
    const manifest = makeManifest({
      auth: {},
      api: { depends_on: ["auth"] },
      web: { depends_on: ["auth", "api"] },
    });

    expect(validateDependencyGraph(manifest)).toEqual({ valid: true });
  });

  test("detects simple cycle", () => {
    const manifest = makeManifest({
      a: { depends_on: ["b"] },
      b: { depends_on: ["a"] },
    });

    const result = validateDependencyGraph(manifest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.cycles.sort()).toEqual(["a", "b"]);
    }
  });

  test("detects cycle in larger graph", () => {
    const manifest = makeManifest({
      a: {},
      b: { depends_on: ["a", "c"] },
      c: { depends_on: ["b"] },
    });

    const result = validateDependencyGraph(manifest);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.cycles.sort()).toEqual(["b", "c"]);
    }
  });

  test("single component with no deps is valid", () => {
    const manifest = makeManifest({ solo: {} });
    expect(validateDependencyGraph(manifest)).toEqual({ valid: true });
  });
});
