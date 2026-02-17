import { describe, test, expect } from "bun:test";
import { join } from "node:path";
import { extractMarkdownLinks, resolveLink, scanLinks } from "./links.js";
import { parseManifest } from "./parser.js";

const FIXTURE_DIR = join(import.meta.dir, "..", "..", "test-fixtures", "link-scan");
const MANIFEST_PATH = join(FIXTURE_DIR, "varp.yaml");

describe("extractMarkdownLinks", () => {
  test("extracts relative markdown links", () => {
    const content = "See [foo](./bar.md) and [baz](../other/file.md).";
    const links = extractMarkdownLinks(content);
    expect(links).toEqual([
      { text: "foo", target: "./bar.md" },
      { text: "baz", target: "../other/file.md" },
    ]);
  });

  test("skips http(s) URLs", () => {
    const content = "Visit [site](https://example.com) and [http](http://example.com).";
    const links = extractMarkdownLinks(content);
    expect(links).toEqual([]);
  });

  test("skips fragment-only links", () => {
    const content = "Jump to [section](#heading).";
    const links = extractMarkdownLinks(content);
    expect(links).toEqual([]);
  });

  test("includes links with anchors attached to paths", () => {
    const content = "See [details](./file.md#section).";
    const links = extractMarkdownLinks(content);
    expect(links).toEqual([{ text: "details", target: "./file.md#section" }]);
  });

  test("handles multiple links on one line", () => {
    const content = "[a](./a.md) and [b](./b.md)";
    const links = extractMarkdownLinks(content);
    expect(links).toHaveLength(2);
  });
});

describe("resolveLink", () => {
  test("resolves relative to source doc directory", () => {
    const result = resolveLink("./bar.md", "/project/docs/foo.md");
    expect(result).toBe("/project/docs/bar.md");
  });

  test("resolves parent-relative paths", () => {
    const result = resolveLink("../other/file.md", "/project/docs/sub/readme.md");
    expect(result).toBe("/project/docs/other/file.md");
  });

  test("strips #anchor before resolving", () => {
    const result = resolveLink("./file.md#heading", "/project/docs/readme.md");
    expect(result).toBe("/project/docs/file.md");
  });
});

describe("scanLinks", () => {
  test("integrity mode finds broken links", () => {
    const manifest = parseManifest(MANIFEST_PATH);
    const result = scanLinks(manifest, "integrity");

    expect(result.broken_links.length).toBeGreaterThan(0);
    const brokenTargets = result.broken_links.map((b) => b.link_target);
    expect(brokenTargets).toContain("./nonexistent.md");
    expect(result.total_links_scanned).toBeGreaterThan(0);
    expect(result.total_docs_scanned).toBeGreaterThan(0);
  });

  test("deps mode infers cross-component dependencies", () => {
    const manifest = parseManifest(MANIFEST_PATH);
    const result = scanLinks(manifest, "deps");

    // auth/README.md links to ../api/routes.md → auth depends on api
    const authToApi = result.inferred_deps.find((d) => d.from === "auth" && d.to === "api");
    expect(authToApi).toBeDefined();
    expect(authToApi!.evidence.length).toBeGreaterThan(0);

    // api/README.md and api/routes.md link to auth → api depends on auth
    const apiToAuth = result.inferred_deps.find((d) => d.from === "api" && d.to === "auth");
    expect(apiToAuth).toBeDefined();
  });

  test("deps mode identifies missing declared deps", () => {
    const manifest = parseManifest(MANIFEST_PATH);
    const result = scanLinks(manifest, "deps");

    // auth has no declared deps but links to api → missing dep
    const missingAuthToApi = result.missing_deps.find((d) => d.from === "auth" && d.to === "api");
    expect(missingAuthToApi).toBeDefined();
  });

  test("all mode returns both broken links and dep analysis", () => {
    const manifest = parseManifest(MANIFEST_PATH);
    const result = scanLinks(manifest, "all");

    expect(result.broken_links.length).toBeGreaterThan(0);
    expect(result.inferred_deps.length).toBeGreaterThan(0);
    expect(result.total_links_scanned).toBeGreaterThan(0);
  });

  test("does not report intra-component links as dependencies", () => {
    const manifest = parseManifest(MANIFEST_PATH);
    const result = scanLinks(manifest, "deps");

    // auth/README.md links to ./internals.md — same component, not a dep
    const selfDep = result.inferred_deps.find((d) => d.from === d.to);
    expect(selfDep).toBeUndefined();
  });
});
