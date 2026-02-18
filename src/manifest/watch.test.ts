import { describe, test, expect } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";

import type { Manifest } from "#shared/types.js";

import { watchFreshness } from "./watch.js";

const TMP = join("/tmp/claude", "watch-freshness-test");

function setup() {
  rmSync(TMP, { recursive: true, force: true });
  mkdirSync(join(TMP, "src/auth"), { recursive: true });
  mkdirSync(join(TMP, "src/api"), { recursive: true });
}

function teardown() {
  rmSync(TMP, { recursive: true, force: true });
}

function makeManifest(): Manifest {
  return {
    varp: "0.1.0",
    components: {
      auth: { path: join(TMP, "src/auth"), docs: [] },
      api: { path: join(TMP, "src/api"), docs: [] },
    },
  };
}

describe("watchFreshness", () => {
  test("returns full snapshot when since is omitted", () => {
    setup();

    // Source file newer than doc → stale
    const oldTime = new Date("2025-01-01T00:00:00Z");
    const newTime = new Date("2026-01-01T00:00:00Z");

    writeFileSync(join(TMP, "src/auth/README.md"), "# Auth");
    utimesSync(join(TMP, "src/auth/README.md"), oldTime, oldTime);
    writeFileSync(join(TMP, "src/auth/index.ts"), "export {}");
    utimesSync(join(TMP, "src/auth/index.ts"), newTime, newTime);

    writeFileSync(join(TMP, "src/api/README.md"), "# API");
    utimesSync(join(TMP, "src/api/README.md"), newTime, newTime);
    writeFileSync(join(TMP, "src/api/index.ts"), "export {}");
    utimesSync(join(TMP, "src/api/index.ts"), oldTime, oldTime);

    const manifest = makeManifest();
    const result = watchFreshness(manifest);

    expect(result.snapshot_time).toBeTruthy();
    // auth is stale (source newer than doc), api is not
    expect(result.total_stale).toBe(1);
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].component).toBe("auth");
    expect(result.changes[0].became_stale).toBe(true);

    teardown();
  });

  test("filters changes by since timestamp", () => {
    setup();

    const t1 = new Date("2025-06-01T00:00:00Z");
    const t2 = new Date("2026-01-01T00:00:00Z");
    const t3 = new Date("2026-02-01T00:00:00Z");

    // auth: source modified at t3, doc at t1 → stale, source changed after since=t2
    writeFileSync(join(TMP, "src/auth/README.md"), "# Auth");
    utimesSync(join(TMP, "src/auth/README.md"), t1, t1);
    writeFileSync(join(TMP, "src/auth/index.ts"), "export {}");
    utimesSync(join(TMP, "src/auth/index.ts"), t3, t3);

    // api: source and doc both modified at t1 → not changed since t2
    writeFileSync(join(TMP, "src/api/README.md"), "# API");
    utimesSync(join(TMP, "src/api/README.md"), t1, t1);
    writeFileSync(join(TMP, "src/api/index.ts"), "export {}");
    utimesSync(join(TMP, "src/api/index.ts"), t1, t1);

    const manifest = makeManifest();
    const result = watchFreshness(manifest, t2.toISOString());

    // Only auth should appear — its source changed after t2
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].component).toBe("auth");
    expect(result.changes[0].became_stale).toBe(true);
    expect(result.total_stale).toBe(1);

    teardown();
  });

  test("returns empty changes when nothing changed since baseline", () => {
    setup();

    const oldTime = new Date("2025-01-01T00:00:00Z");

    writeFileSync(join(TMP, "src/auth/README.md"), "# Auth");
    utimesSync(join(TMP, "src/auth/README.md"), oldTime, oldTime);
    writeFileSync(join(TMP, "src/auth/index.ts"), "export {}");
    utimesSync(join(TMP, "src/auth/index.ts"), oldTime, oldTime);

    const manifest = makeManifest();
    // Since is after all modifications
    const result = watchFreshness(manifest, "2026-01-01T00:00:00Z");

    expect(result.changes).toEqual([]);

    teardown();
  });
});
