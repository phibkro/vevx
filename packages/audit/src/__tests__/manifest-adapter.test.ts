import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { tmpdir } from "os";
import { resolve, join } from "path";

import {
  findManifest,
  parseManifest,
  matchRulesByTags,
  assignFilesToComponents,
} from "../planner/manifest-adapter";
import type { AuditComponent } from "../planner/types";
import type { Rule } from "../planner/types";

// ── Test helpers ──

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "audit-manifest-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeManifest(dir: string, content: string): string {
  const path = join(dir, "varp.yaml");
  writeFileSync(path, content, "utf-8");
  return path;
}

const SAMPLE_MANIFEST = `
varp: 0.1.0

api:
  path: ./src/api
  tags: [api, http]
  deps: [db]

db:
  path: ./src/db
  tags: [database]

utils:
  path: ./src/utils
  tags: [shared]
`;

// ── findManifest ──

describe("findManifest", () => {
  it("finds varp.yaml in the target directory", () => {
    writeManifest(tempDir, SAMPLE_MANIFEST);
    const result = findManifest(tempDir);
    expect(result).toBe(join(tempDir, "varp.yaml"));
  });

  it("finds varp.yaml in parent directories", () => {
    writeManifest(tempDir, SAMPLE_MANIFEST);
    const subDir = join(tempDir, "src", "api");
    mkdirSync(subDir, { recursive: true });

    const result = findManifest(subDir);
    expect(result).toBe(join(tempDir, "varp.yaml"));
  });

  it("returns null when no manifest found", () => {
    const result = findManifest(tempDir);
    expect(result).toBeNull();
  });
});

// ── parseManifest ──

describe("parseManifest", () => {
  it("parses components with paths, tags, and deps", () => {
    const path = writeManifest(tempDir, SAMPLE_MANIFEST);
    const manifest = parseManifest(path);

    expect(manifest.varp).toBe("0.1.0");
    expect(Object.keys(manifest.components)).toEqual(["api", "db", "utils"]);

    expect(manifest.components.api.tags).toEqual(["api", "http"]);
    expect(manifest.components.api.deps).toEqual(["db"]);
    expect(manifest.components.db.tags).toEqual(["database"]);
  });

  it("resolves paths relative to manifest directory", () => {
    const path = writeManifest(tempDir, SAMPLE_MANIFEST);
    const manifest = parseManifest(path);

    expect(manifest.components.api.path).toBe(resolve(tempDir, "src/api"));
  });

  it("throws on missing varp key", () => {
    const path = writeManifest(tempDir, "foo: bar");
    expect(() => parseManifest(path)).toThrow("missing 'varp' key");
  });

  it("handles multi-path components", () => {
    const manifest = `
varp: 0.1.0

multi:
  path:
    - ./src/a
    - ./src/b
  tags: [test]
`;
    const path = writeManifest(tempDir, manifest);
    const result = parseManifest(path);
    const paths = result.components.multi.path;
    expect(Array.isArray(paths)).toBe(true);
    expect((paths as string[]).length).toBe(2);
  });
});

// ── matchRulesByTags ──

describe("matchRulesByTags", () => {
  const makeRule = (appliesTo: string[]): Rule => ({
    id: "TEST-01",
    title: "Test",
    category: "Test",
    severity: "High",
    appliesTo,
    compliant: "",
    violation: "",
    whatToLookFor: [],
    guidance: "",
  });

  it("matches when component tag is in rule appliesTo", () => {
    expect(matchRulesByTags(["api", "http"], makeRule(["API routes"]))).toBe(true);
  });

  it("matches when rule tag contains component tag", () => {
    expect(matchRulesByTags(["database"], makeRule(["database access layers"]))).toBe(true);
  });

  it("returns false when no tags match", () => {
    expect(matchRulesByTags(["frontend"], makeRule(["database access layers"]))).toBe(false);
  });

  it("returns true when rule has no appliesTo", () => {
    expect(matchRulesByTags(["anything"], makeRule([]))).toBe(true);
  });

  it("returns false when component has no tags", () => {
    expect(matchRulesByTags([], makeRule(["API routes"]))).toBe(false);
  });
});

// ── assignFilesToComponents ──

describe("assignFilesToComponents", () => {
  it("assigns files to components based on path containment", () => {
    const manifestPath = writeManifest(tempDir, SAMPLE_MANIFEST);
    const manifest = parseManifest(manifestPath);

    // Create component dirs
    mkdirSync(join(tempDir, "src", "api"), { recursive: true });
    mkdirSync(join(tempDir, "src", "db"), { recursive: true });

    const components: AuditComponent[] = [
      {
        name: "api",
        path: resolve(tempDir, "src/api"),
        files: [],
        languages: [],
        estimatedTokens: 0,
      },
      {
        name: "db",
        path: resolve(tempDir, "src/db"),
        files: [],
        languages: [],
        estimatedTokens: 0,
      },
    ];

    const files = [
      {
        relativePath: "src/api/routes.ts",
        language: "typescript",
        content: "const x = 1;",
        path: "/test/src/api/routes.ts",
        size: 100,
      },
      {
        relativePath: "src/api/auth.ts",
        language: "typescript",
        content: "const y = 2;",
        path: "/test/src/api/auth.ts",
        size: 100,
      },
      {
        relativePath: "src/db/queries.ts",
        language: "typescript",
        content: "const z = 3;",
        path: "/test/src/db/queries.ts",
        size: 100,
      },
      {
        relativePath: "src/other/util.ts",
        language: "typescript",
        content: "const w = 4;",
        path: "/test/src/other/util.ts",
        size: 100,
      },
    ];

    assignFilesToComponents(components, manifest, files, tempDir);

    expect(components[0].files).toEqual(["src/api/routes.ts", "src/api/auth.ts"]);
    expect(components[1].files).toEqual(["src/db/queries.ts"]);
    expect(components[0].languages).toContain("typescript");
    expect(components[0].estimatedTokens).toBeGreaterThan(0);
  });
});
