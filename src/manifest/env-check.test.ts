import { describe, test, expect } from "bun:test";

import type { Manifest } from "#shared/types.js";

import { checkEnv } from "./env-check.js";

const MANIFEST: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/project/src/auth", env: ["JWT_SECRET", "AUTH_DB_URL"], docs: [] },
    api: { path: "/project/src/api", env: ["DATABASE_URL", "REDIS_URL"], docs: [] },
    web: { path: "/project/src/web", docs: [] },
  },
};

describe("checkEnv", () => {
  test("collects env vars from multiple components", () => {
    const result = checkEnv(MANIFEST, ["auth", "api"], {});
    expect(result.required).toEqual(["AUTH_DB_URL", "DATABASE_URL", "JWT_SECRET", "REDIS_URL"]);
  });

  test("deduplicates env vars across components", () => {
    const manifest: Manifest = {
      varp: "0.1.0",
      components: {
        a: { path: "/a", env: ["SHARED", "A_ONLY"], docs: [] },
        b: { path: "/b", env: ["SHARED", "B_ONLY"], docs: [] },
      },
    };
    const result = checkEnv(manifest, ["a", "b"], {});
    expect(result.required).toEqual(["A_ONLY", "B_ONLY", "SHARED"]);
  });

  test("detects set vs missing env vars", () => {
    const result = checkEnv(MANIFEST, ["auth"], {
      JWT_SECRET: "secret123",
    });
    expect(result.required).toEqual(["AUTH_DB_URL", "JWT_SECRET"]);
    expect(result.set).toEqual(["JWT_SECRET"]);
    expect(result.missing).toEqual(["AUTH_DB_URL"]);
  });

  test("all set when env is fully populated", () => {
    const result = checkEnv(MANIFEST, ["api"], {
      DATABASE_URL: "postgres://...",
      REDIS_URL: "redis://...",
    });
    expect(result.missing).toEqual([]);
    expect(result.set).toEqual(["DATABASE_URL", "REDIS_URL"]);
  });

  test("component with no env field returns empty", () => {
    const result = checkEnv(MANIFEST, ["web"], {});
    expect(result.required).toEqual([]);
    expect(result.set).toEqual([]);
    expect(result.missing).toEqual([]);
  });

  test("unknown component names are skipped gracefully", () => {
    const result = checkEnv(MANIFEST, ["nonexistent"], {});
    expect(result.required).toEqual([]);
  });
});
