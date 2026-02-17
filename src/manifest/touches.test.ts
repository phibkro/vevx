import { describe, test, expect } from "bun:test";
import { suggestTouches } from "./touches.js";
import type { Manifest, ImportDep } from "../types.js";

const manifest: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/project/src/auth", docs: [] },
    api: { path: "/project/src/api", deps: ["auth"], docs: [] },
    web: { path: "/project/src/web", deps: ["api"], docs: [] },
  },
};

const importDeps: ImportDep[] = [
  {
    from: "api",
    to: "auth",
    evidence: [{ source_file: "/project/src/api/routes.ts", import_specifier: "../auth/index.js" }],
  },
  {
    from: "web",
    to: "api",
    evidence: [{ source_file: "/project/src/web/app.ts", import_specifier: "../api/index.js" }],
  },
];

describe("suggestTouches", () => {
  test("files in one component → writes: [that component]", () => {
    const result = suggestTouches(["/project/src/auth/index.ts"], manifest, importDeps);
    expect(result.writes).toEqual(["auth"]);
  });

  test("files in multiple components → writes: [both]", () => {
    const result = suggestTouches(
      ["/project/src/auth/index.ts", "/project/src/api/routes.ts"],
      manifest,
      importDeps,
    );
    expect(result.writes).toEqual(["api", "auth"]);
  });

  test("import dep from write component to other → reads includes other", () => {
    const result = suggestTouches(["/project/src/api/routes.ts"], manifest, importDeps);
    expect(result.writes).toEqual(["api"]);
    expect(result.reads).toEqual(["auth"]);
  });

  test("import dep target already in writes → not duplicated in reads", () => {
    const result = suggestTouches(
      ["/project/src/api/routes.ts", "/project/src/auth/index.ts"],
      manifest,
      importDeps,
    );
    expect(result.writes).toEqual(["api", "auth"]);
    // auth is already in writes, so it should not appear in reads
    expect(result.reads).toBeUndefined();
  });

  test("file outside all components → ignored", () => {
    const result = suggestTouches(["/project/lib/external.ts"], manifest, importDeps);
    expect(result.writes).toBeUndefined();
    expect(result.reads).toBeUndefined();
  });

  test("no import deps → reads is undefined", () => {
    const result = suggestTouches(["/project/src/auth/index.ts"], manifest, []);
    expect(result.writes).toEqual(["auth"]);
    expect(result.reads).toBeUndefined();
  });
});
