import { describe, expect, test } from "bun:test";

import { Effect } from "effect";

import { Config, ConfigLive } from "./Config.js";

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
