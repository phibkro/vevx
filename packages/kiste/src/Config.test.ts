import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import * as Schema from "effect/Schema";
import { Config, ConfigLive, ConfigSchema } from "./Config.js";

describe("ConfigSchema", () => {
  test("defaults when decoding empty object", () => {
    const result = Schema.decodeUnknownSync(ConfigSchema)({});
    expect(result.strip_prefixes).toEqual(["src", "lib", "components", "app", "pages"]);
    expect(result.stop_tags).toEqual(["index", "utils", "helpers", "types"]);
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
    expect(result.stop_tags).toEqual(["index", "utils", "helpers", "types"]);
    expect(result.snapshot_frequency).toBe(1000);
  });
});

describe("ConfigLive", () => {
  test("returns defaults for missing file", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* Config;
      }).pipe(Effect.provide(ConfigLive("/nonexistent/path"))),
    );
    expect(result.strip_prefixes).toEqual(["src", "lib", "components", "app", "pages"]);
    expect(result.db_path).toBe(".kiste/index.sqlite");
  });
});
