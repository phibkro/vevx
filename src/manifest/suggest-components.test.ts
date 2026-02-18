import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractStem,
  clusterByNameStem,
  detectLayerDirs,
  detectDomainDirs,
  suggestComponentsFromDomains,
  suggestComponents,
  type StemEntry,
} from "./suggest-components.js";

const TMP = join("/tmp/claude", "suggest-components-test");

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(TMP, { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

describe("extractStem", () => {
  const defaultSuffixes = [".controller", ".service", ".repository", ".model", ".handler"];

  test("strips .controller.ts suffix", () => {
    expect(extractStem("user.controller.ts", defaultSuffixes)).toBe("user");
  });

  test("strips .service.ts suffix", () => {
    expect(extractStem("auth.service.ts", defaultSuffixes)).toBe("auth");
  });

  test("strips .repository.tsx suffix", () => {
    expect(extractStem("order.repository.tsx", defaultSuffixes)).toBe("order");
  });

  test("returns filename without extension when no suffix matches", () => {
    expect(extractStem("utils.ts", defaultSuffixes)).toBe("utils");
  });

  test("returns null for non-code files", () => {
    expect(extractStem("README.md", defaultSuffixes)).toBeNull();
    expect(extractStem("config.json", defaultSuffixes)).toBeNull();
    expect(extractStem("Dockerfile", defaultSuffixes)).toBeNull();
  });

  test("handles custom suffixes", () => {
    expect(extractStem("user.resolver.ts", [".resolver"])).toBe("user");
  });

  test("handles .js and .jsx extensions", () => {
    expect(extractStem("user.controller.js", defaultSuffixes)).toBe("user");
    expect(extractStem("user.handler.jsx", defaultSuffixes)).toBe("user");
  });
});

describe("clusterByNameStem", () => {
  test("groups entries by stem across 2+ layers", () => {
    const entries: StemEntry[] = [
      { layerDir: "controllers", stem: "user", filename: "user.controller.ts" },
      { layerDir: "services", stem: "user", filename: "user.service.ts" },
      { layerDir: "repositories", stem: "user", filename: "user.repository.ts" },
    ];
    const result = clusterByNameStem(entries);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("user");
    expect(result[0].path).toEqual(["controllers", "repositories", "services"]);
    expect(result[0].evidence).toHaveLength(3);
  });

  test("skips stems appearing in only one layer", () => {
    const entries: StemEntry[] = [
      { layerDir: "controllers", stem: "user", filename: "user.controller.ts" },
      { layerDir: "services", stem: "user", filename: "user.service.ts" },
      { layerDir: "controllers", stem: "health", filename: "health.controller.ts" },
    ];
    const result = clusterByNameStem(entries);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("user");
  });

  test("returns empty array when no stems span 2+ layers", () => {
    const entries: StemEntry[] = [
      { layerDir: "controllers", stem: "user", filename: "user.controller.ts" },
      { layerDir: "controllers", stem: "auth", filename: "auth.controller.ts" },
    ];
    const result = clusterByNameStem(entries);
    expect(result).toEqual([]);
  });

  test("sorts results by name", () => {
    const entries: StemEntry[] = [
      { layerDir: "controllers", stem: "zebra", filename: "zebra.controller.ts" },
      { layerDir: "services", stem: "zebra", filename: "zebra.service.ts" },
      { layerDir: "controllers", stem: "alpha", filename: "alpha.controller.ts" },
      { layerDir: "services", stem: "alpha", filename: "alpha.service.ts" },
    ];
    const result = clusterByNameStem(entries);
    expect(result.map((c) => c.name)).toEqual(["alpha", "zebra"]);
  });
});

describe("detectLayerDirs", () => {
  test("finds conventional layer directory names", () => {
    setup();
    mkdirSync(join(TMP, "controllers"));
    mkdirSync(join(TMP, "services"));
    mkdirSync(join(TMP, "unrelated"));

    const result = detectLayerDirs(TMP);
    expect(result).toEqual(["controllers", "services"]);
    teardown();
  });

  test("returns empty array for nonexistent directory", () => {
    expect(detectLayerDirs("/tmp/claude/nonexistent-dir-xyz")).toEqual([]);
  });

  test("ignores files with layer names (only directories)", () => {
    setup();
    writeFileSync(join(TMP, "controllers"), "not a dir");
    mkdirSync(join(TMP, "services"));

    const result = detectLayerDirs(TMP);
    expect(result).toEqual(["services"]);
    teardown();
  });
});

describe("suggestComponents", () => {
  test("end-to-end with temp directory", () => {
    setup();

    // Create layer structure
    mkdirSync(join(TMP, "controllers"), { recursive: true });
    mkdirSync(join(TMP, "services"), { recursive: true });
    mkdirSync(join(TMP, "repositories"), { recursive: true });

    // user appears in all 3 layers
    writeFileSync(join(TMP, "controllers/user.controller.ts"), "");
    writeFileSync(join(TMP, "services/user.service.ts"), "");
    writeFileSync(join(TMP, "repositories/user.repository.ts"), "");

    // order appears in 2 layers
    writeFileSync(join(TMP, "controllers/order.controller.ts"), "");
    writeFileSync(join(TMP, "services/order.service.ts"), "");

    // health appears in only 1 layer — should not be suggested
    writeFileSync(join(TMP, "controllers/health.controller.ts"), "");

    const result = suggestComponents(TMP);

    expect(result.layer_dirs_scanned).toEqual(["controllers", "repositories", "services"]);
    expect(result.components).toHaveLength(2);

    const names = result.components.map((c) => c.name);
    expect(names).toEqual(["order", "user"]);

    const user = result.components.find((c) => c.name === "user")!;
    expect(user.path).toEqual(["controllers", "repositories", "services"]);

    teardown();
  });

  test("accepts custom layer dirs", () => {
    setup();

    mkdirSync(join(TMP, "api"), { recursive: true });
    mkdirSync(join(TMP, "domain"), { recursive: true });

    writeFileSync(join(TMP, "api/user.ts"), "");
    writeFileSync(join(TMP, "domain/user.ts"), "");

    const result = suggestComponents(TMP, { layerDirs: ["api", "domain"] });

    expect(result.layer_dirs_scanned).toEqual(["api", "domain"]);
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe("user");

    teardown();
  });

  test("accepts custom suffixes", () => {
    setup();

    mkdirSync(join(TMP, "controllers"), { recursive: true });
    mkdirSync(join(TMP, "services"), { recursive: true });

    writeFileSync(join(TMP, "controllers/user.ctrl.ts"), "");
    writeFileSync(join(TMP, "services/user.svc.ts"), "");

    const result = suggestComponents(TMP, { suffixes: [".ctrl", ".svc"] });

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe("user");

    teardown();
  });

  test("returns empty components when no stems span layers", () => {
    setup();

    mkdirSync(join(TMP, "controllers"), { recursive: true });
    writeFileSync(join(TMP, "controllers/user.controller.ts"), "");

    const result = suggestComponents(TMP);
    expect(result.components).toEqual([]);

    teardown();
  });
});

describe("detectDomainDirs", () => {
  test("finds domain dirs with 2+ layer subdirs", () => {
    setup();
    mkdirSync(join(TMP, "auth/controllers"), { recursive: true });
    mkdirSync(join(TMP, "auth/services"), { recursive: true });
    mkdirSync(join(TMP, "auth/models"), { recursive: true });
    mkdirSync(join(TMP, "utils"), { recursive: true }); // no layer subdirs

    const result = detectDomainDirs(TMP);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("auth");
    expect(result[0].layers).toEqual(["controllers", "models", "services"]);

    teardown();
  });

  test("skips dirs with fewer than 2 layer subdirs", () => {
    setup();
    mkdirSync(join(TMP, "auth/controllers"), { recursive: true });
    mkdirSync(join(TMP, "auth/lib"), { recursive: true }); // not a layer name

    const result = detectDomainDirs(TMP);
    expect(result).toEqual([]);

    teardown();
  });

  test("returns empty for nonexistent directory", () => {
    expect(detectDomainDirs("/tmp/claude/nonexistent-dir-xyz")).toEqual([]);
  });

  test("sorts results by name", () => {
    setup();
    mkdirSync(join(TMP, "zebra/controllers"), { recursive: true });
    mkdirSync(join(TMP, "zebra/services"), { recursive: true });
    mkdirSync(join(TMP, "alpha/controllers"), { recursive: true });
    mkdirSync(join(TMP, "alpha/services"), { recursive: true });

    const result = detectDomainDirs(TMP);
    expect(result.map((d) => d.name)).toEqual(["alpha", "zebra"]);

    teardown();
  });
});

describe("suggestComponentsFromDomains", () => {
  test("creates multi-path components from domain dirs", () => {
    setup();
    mkdirSync(join(TMP, "auth/controllers"), { recursive: true });
    mkdirSync(join(TMP, "auth/services"), { recursive: true });
    mkdirSync(join(TMP, "auth/repositories"), { recursive: true });
    writeFileSync(join(TMP, "auth/controllers/login.ts"), "");
    writeFileSync(join(TMP, "auth/services/auth-service.ts"), "");

    const result = suggestComponentsFromDomains(TMP);

    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe("auth");
    expect(result.components[0].path).toEqual([
      "auth/controllers",
      "auth/repositories",
      "auth/services",
    ]);
    expect(result.components[0].evidence).toHaveLength(3);

    teardown();
  });
});

describe("suggestComponents with mode", () => {
  test("mode=layers only detects layer-organized projects", () => {
    setup();
    // Domain structure (should be ignored in layers mode)
    mkdirSync(join(TMP, "auth/controllers"), { recursive: true });
    mkdirSync(join(TMP, "auth/services"), { recursive: true });

    const result = suggestComponents(TMP, { mode: "layers" });
    expect(result.components).toEqual([]);

    teardown();
  });

  test("mode=domains only detects domain-organized projects", () => {
    setup();
    // Layer structure (should be ignored in domains mode)
    mkdirSync(join(TMP, "controllers"), { recursive: true });
    mkdirSync(join(TMP, "services"), { recursive: true });
    writeFileSync(join(TMP, "controllers/user.controller.ts"), "");
    writeFileSync(join(TMP, "services/user.service.ts"), "");

    // Domain structure
    mkdirSync(join(TMP, "auth/controllers"), { recursive: true });
    mkdirSync(join(TMP, "auth/services"), { recursive: true });

    const result = suggestComponents(TMP, { mode: "domains" });
    expect(result.components).toHaveLength(1);
    expect(result.components[0].name).toBe("auth");

    teardown();
  });

  test("mode=auto merges both modes and deduplicates", () => {
    setup();

    // Layer structure — produces "user" component
    mkdirSync(join(TMP, "controllers"), { recursive: true });
    mkdirSync(join(TMP, "services"), { recursive: true });
    writeFileSync(join(TMP, "controllers/user.controller.ts"), "");
    writeFileSync(join(TMP, "services/user.service.ts"), "");

    // Domain structure — produces "auth" component
    mkdirSync(join(TMP, "auth/controllers"), { recursive: true });
    mkdirSync(join(TMP, "auth/services"), { recursive: true });

    const result = suggestComponents(TMP, { mode: "auto" });
    const names = result.components.map((c) => c.name);
    expect(names).toContain("user");
    expect(names).toContain("auth");

    teardown();
  });

  test("auto mode deduplicates by name (layer wins)", () => {
    setup();

    // Both modes produce a component named "auth"
    // Layer: auth appears in controllers/ and services/
    mkdirSync(join(TMP, "controllers"), { recursive: true });
    mkdirSync(join(TMP, "services"), { recursive: true });
    writeFileSync(join(TMP, "controllers/auth.controller.ts"), "");
    writeFileSync(join(TMP, "services/auth.service.ts"), "");

    // Domain: auth/ with layer subdirs
    mkdirSync(join(TMP, "auth/controllers"), { recursive: true });
    mkdirSync(join(TMP, "auth/services"), { recursive: true });

    const result = suggestComponents(TMP, { mode: "auto" });
    const authComponents = result.components.filter((c) => c.name === "auth");
    expect(authComponents).toHaveLength(1);
    // Layer result should win — paths are layer dirs, not domain subdirs
    expect(authComponents[0].path).toEqual(["controllers", "services"]);

    teardown();
  });
});
