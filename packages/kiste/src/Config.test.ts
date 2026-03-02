import { describe, expect, test } from "bun:test";

import * as Schema from "effect/Schema";

import { ConfigSchema } from "./Config.js";

describe("ConfigSchema", () => {
  test("defaults when decoding empty object", () => {
    const result = Schema.decodeUnknownSync(ConfigSchema)({});
    expect(result.strip_prefixes).toEqual(["src", "lib", "components", "app", "pages"]);
    expect(result.stop_tags).toEqual([
      "index",
      "utils",
      "helpers",
      "types",
      "__tests__",
      "test",
      "tests",
      "cache",
      "build",
      "coverage",
      ".turbo",
    ]);
    expect(result.snapshot_frequency).toBe(500);
    expect(result.exclude).toEqual(["node_modules/**", "dist/**", "*.lock"]);
    expect(result.db_path).toBe(".kiste/index.sqlite");
  });

  test("partial override merges with defaults", () => {
    const result = Schema.decodeUnknownSync(ConfigSchema)({
      strip_prefixes: ["src", "packages"],
      snapshot_frequency: 1000,
    });
    expect(result.strip_prefixes).toEqual(["src", "packages"]);
    expect(result.stop_tags).toEqual([
      "index",
      "utils",
      "helpers",
      "types",
      "__tests__",
      "test",
      "tests",
      "cache",
      "build",
      "coverage",
      ".turbo",
    ]);
    expect(result.snapshot_frequency).toBe(1000);
  });
});
