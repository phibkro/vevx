import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  extractStem,
  clusterByNameStem,
  detectLayerDirs,
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
