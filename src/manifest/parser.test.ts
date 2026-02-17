import { describe, test, expect } from "bun:test";
import { resolve } from "node:path";

import { parseManifest } from "./parser.js";

const FIXTURE_DIR = resolve(import.meta.dir, "../../test-fixtures");
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("parseManifest", () => {
  test("parses the project's own varp.yaml", () => {
    const manifest = parseManifest(resolve(PROJECT_ROOT, "varp.yaml"));

    expect(manifest.varp).toBe("0.1.0");
    expect(manifest.components.core).toBeDefined();
    expect(manifest.components.core.path).toBe(resolve(PROJECT_ROOT, "src"));
    // Explicit docs for submodule READMEs (outside auto-discovery scope)
    expect(manifest.components.core.docs).toHaveLength(2);
    expect(manifest.components.core.docs[0]).toContain("manifest/README.md");
    expect(manifest.components.core.docs[1]).toContain("plan/README.md");
  });

  test("parses manifest with dependencies", () => {
    const manifest = parseManifest(resolve(FIXTURE_DIR, "multi-component.yaml"));

    expect(Object.keys(manifest.components)).toEqual(["auth", "api", "web"]);
    expect(manifest.components.api.deps).toEqual(["auth"]);
    expect(manifest.components.web.deps).toEqual(["auth", "api"]);
  });

  test("parses tags, test, env, and stability fields", () => {
    const manifest = parseManifest(resolve(FIXTURE_DIR, "multi-component.yaml"));

    expect(manifest.components.auth.tags).toEqual(["security", "api-boundary"]);
    expect(manifest.components.auth.stability).toBe("stable");
    expect(manifest.components.auth.test).toBeUndefined();
    expect(manifest.components.auth.env).toBeUndefined();

    expect(manifest.components.api.env).toEqual(["DATABASE_URL"]);
    expect(manifest.components.api.test).toBe("bun test src/api --timeout 5000");
    expect(manifest.components.api.tags).toBeUndefined();

    expect(manifest.components.web.tags).toEqual(["frontend"]);
    expect(manifest.components.web.stability).toBe("active");
  });

  test("rejects invalid stability value", () => {
    expect(() => parseManifest(resolve(FIXTURE_DIR, "invalid-stability.yaml"))).toThrow();
  });

  test("throws on invalid manifest", () => {
    expect(() => parseManifest(resolve(FIXTURE_DIR, "invalid.yaml"))).toThrow();
  });

  test("parses flat YAML format without components wrapper", () => {
    const manifest = parseManifest(resolve(PROJECT_ROOT, "varp.yaml"));

    // Should have components directly from top-level keys
    expect(manifest.components.core).toBeDefined();
    expect(manifest.components.skills).toBeDefined();
    expect(manifest.components.hooks).toBeDefined();
    // Should not have 'name' on manifest
    expect((manifest as any).name).toBeUndefined();
  });

  test("resolves doc paths to absolute paths", () => {
    const manifest = parseManifest(resolve(PROJECT_ROOT, "varp.yaml"));

    for (const doc of manifest.components.core.docs) {
      expect(doc).toMatch(/^\//); // absolute path
    }
  });
});
