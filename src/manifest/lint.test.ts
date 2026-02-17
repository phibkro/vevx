import { describe, test, expect } from "bun:test";

import type { Manifest, ImportScanResult, LinkScanResult, FreshnessReport } from "../types.js";
import { lint } from "./lint.js";

const MANIFEST: Manifest = {
  varp: "0.1.0",
  components: {
    auth: { path: "/project/src/auth", docs: [] },
    api: { path: "/project/src/api", deps: ["auth"], docs: [] },
  },
};

function makeImportResult(overrides: Partial<ImportScanResult> = {}): ImportScanResult {
  return {
    import_deps: [],
    missing_deps: [],
    extra_deps: [],
    total_files_scanned: 0,
    total_imports_scanned: 0,
    ...overrides,
  };
}

function makeLinkResult(overrides: Partial<LinkScanResult> = {}): LinkScanResult {
  return {
    inferred_deps: [],
    missing_deps: [],
    extra_deps: [],
    broken_links: [],
    missing_docs: [],
    total_links_scanned: 0,
    total_docs_scanned: 0,
    ...overrides,
  };
}

function makeFreshnessReport(overrides: Partial<FreshnessReport> = {}): FreshnessReport {
  return {
    components: {
      auth: {
        docs: {
          README: {
            path: "/project/src/auth/README.md",
            last_modified: "2026-02-16T00:00:00.000Z",
            stale: false,
          },
        },
        source_last_modified: "2026-02-15T00:00:00.000Z",
      },
      api: {
        docs: {
          README: {
            path: "/project/src/api/README.md",
            last_modified: "2026-02-16T00:00:00.000Z",
            stale: false,
          },
        },
        source_last_modified: "2026-02-15T00:00:00.000Z",
      },
    },
    ...overrides,
  };
}

describe("lint", () => {
  test("clean results produce zero issues", () => {
    const report = lint(MANIFEST, makeImportResult(), makeLinkResult(), makeFreshnessReport());
    expect(report.total_issues).toBe(0);
    expect(report.issues).toEqual([]);
  });

  test("undeclared import deps produce error", () => {
    const report = lint(
      MANIFEST,
      makeImportResult({
        missing_deps: [
          {
            from: "auth",
            to: "api",
            evidence: [{ source_file: "/src/auth/index.ts", import_specifier: "../api/client.js" }],
          },
        ],
      }),
      makeLinkResult(),
      makeFreshnessReport(),
    );
    expect(report.total_issues).toBe(1);
    expect(report.issues[0].severity).toBe("error");
    expect(report.issues[0].category).toBe("imports");
    expect(report.issues[0].component).toBe("auth");
  });

  test("unused import deps produce warning", () => {
    const report = lint(
      MANIFEST,
      makeImportResult({
        extra_deps: [{ from: "api", to: "auth" }],
      }),
      makeLinkResult(),
      makeFreshnessReport(),
    );
    expect(report.total_issues).toBe(1);
    expect(report.issues[0].severity).toBe("warning");
    expect(report.issues[0].category).toBe("imports");
    expect(report.issues[0].component).toBe("api");
  });

  test("broken links produce error", () => {
    const report = lint(
      MANIFEST,
      makeImportResult(),
      makeLinkResult({
        broken_links: [
          {
            source_doc: "/project/src/auth/README.md",
            source_component: "auth",
            link_text: "API docs",
            link_target: "../api/nonexistent.md",
            resolved_path: "/project/src/api/nonexistent.md",
            reason: "file not found",
          },
        ],
      }),
      makeFreshnessReport(),
    );
    expect(report.total_issues).toBe(1);
    expect(report.issues[0].severity).toBe("error");
    expect(report.issues[0].category).toBe("links");
    expect(report.issues[0].component).toBe("auth");
  });

  test("undeclared link deps produce warning", () => {
    const report = lint(
      MANIFEST,
      makeImportResult(),
      makeLinkResult({
        missing_deps: [
          {
            from: "auth",
            to: "api",
            evidence: [{ source_doc: "/src/auth/README.md", link_target: "../api/README.md" }],
          },
        ],
      }),
      makeFreshnessReport(),
    );
    expect(report.total_issues).toBe(1);
    expect(report.issues[0].severity).toBe("warning");
    expect(report.issues[0].category).toBe("links");
  });

  test("unused link deps produce warning", () => {
    const report = lint(
      MANIFEST,
      makeImportResult(),
      makeLinkResult({
        extra_deps: [{ from: "api", to: "auth" }],
      }),
      makeFreshnessReport(),
    );
    expect(report.total_issues).toBe(1);
    expect(report.issues[0].severity).toBe("warning");
    expect(report.issues[0].category).toBe("links");
  });

  test("stale docs produce warning", () => {
    const report = lint(
      MANIFEST,
      makeImportResult(),
      makeLinkResult(),
      makeFreshnessReport({
        components: {
          auth: {
            docs: {
              README: {
                path: "/project/src/auth/README.md",
                last_modified: "2026-02-14T00:00:00.000Z",
                stale: true,
              },
            },
            source_last_modified: "2026-02-16T00:00:00.000Z",
          },
          api: {
            docs: {
              README: {
                path: "/project/src/api/README.md",
                last_modified: "2026-02-16T00:00:00.000Z",
                stale: false,
              },
            },
            source_last_modified: "2026-02-15T00:00:00.000Z",
          },
        },
      }),
    );
    expect(report.total_issues).toBe(1);
    expect(report.issues[0].severity).toBe("warning");
    expect(report.issues[0].category).toBe("freshness");
    expect(report.issues[0].component).toBe("auth");
  });

  test("multiple issue types aggregated correctly", () => {
    const report = lint(
      MANIFEST,
      makeImportResult({
        missing_deps: [
          {
            from: "auth",
            to: "api",
            evidence: [{ source_file: "/src/auth/index.ts", import_specifier: "../api/client.js" }],
          },
        ],
      }),
      makeLinkResult({
        broken_links: [
          {
            source_doc: "/project/src/auth/README.md",
            source_component: "auth",
            link_text: "missing",
            link_target: "./missing.md",
            resolved_path: "/project/src/auth/missing.md",
            reason: "file not found",
          },
        ],
      }),
      makeFreshnessReport({
        components: {
          auth: {
            docs: {
              README: {
                path: "/project/src/auth/README.md",
                last_modified: "2026-02-14T00:00:00.000Z",
                stale: true,
              },
            },
            source_last_modified: "2026-02-16T00:00:00.000Z",
          },
          api: {
            docs: {},
            source_last_modified: "2026-02-15T00:00:00.000Z",
          },
        },
      }),
    );
    expect(report.total_issues).toBe(3);
    const categories = report.issues.map((i) => i.category).sort();
    expect(categories).toEqual(["freshness", "imports", "links"]);
    const errors = report.issues.filter((i) => i.severity === "error");
    const warnings = report.issues.filter((i) => i.severity === "warning");
    expect(errors).toHaveLength(2);
    expect(warnings).toHaveLength(1);
  });

  test("total_issues matches issues array length", () => {
    const report = lint(
      MANIFEST,
      makeImportResult({
        extra_deps: [
          { from: "api", to: "auth" },
          { from: "auth", to: "api" },
        ],
      }),
      makeLinkResult(),
      makeFreshnessReport(),
    );
    expect(report.total_issues).toBe(report.issues.length);
    expect(report.total_issues).toBe(2);
  });
});
