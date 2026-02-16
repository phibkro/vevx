import { describe, test, expect } from "bun:test";
import { parseManifest } from "./parser.js";
import { resolve } from "node:path";

const FIXTURE_DIR = resolve(import.meta.dir, "../../test-fixtures");
const PROJECT_ROOT = resolve(import.meta.dir, "../..");

describe("parseManifest", () => {
  test("parses the project's own varp.yaml", () => {
    const manifest = parseManifest(resolve(PROJECT_ROOT, "varp.yaml"));

    expect(manifest.varp).toBe("0.1.0");
    expect(manifest.name).toBe("varp");
    expect(manifest.components.core).toBeDefined();
    expect(manifest.components.core.path).toBe(
      resolve(PROJECT_ROOT, "src"),
    );
    expect(manifest.components.core.docs.interface).toBe(
      resolve(PROJECT_ROOT, "docs/core/interface.md"),
    );
  });

  test("parses manifest with dependencies", () => {
    const manifest = parseManifest(
      resolve(FIXTURE_DIR, "multi-component.yaml"),
    );

    expect(Object.keys(manifest.components)).toEqual(["auth", "api", "web"]);
    expect(manifest.components.api.depends_on).toEqual(["auth"]);
    expect(manifest.components.web.depends_on).toEqual(["auth", "api"]);
  });

  test("throws on invalid manifest", () => {
    expect(() =>
      parseManifest(resolve(FIXTURE_DIR, "invalid.yaml")),
    ).toThrow();
  });
});
