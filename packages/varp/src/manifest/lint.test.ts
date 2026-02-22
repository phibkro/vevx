import { describe, test, expect } from "bun:test";

import type { Manifest, ImportScanResult, LinkScanResult, FreshnessReport } from "#shared/types.js";

import { issueKey, lint } from "./lint.js";

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
    components_with_source: [],
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

  // ── Composed unused-dep checks ──

  test("unused dep warns only when both imports AND links agree", () => {
    const report = lint(
      MANIFEST,
      makeImportResult({
        extra_deps: [{ from: "api", to: "auth" }],
        components_with_source: ["api"],
      }),
      makeLinkResult({
        extra_deps: [{ from: "api", to: "auth" }],
      }),
      makeFreshnessReport(),
    );
    const depIssues = report.issues.filter((i) => i.category === "deps");
    expect(depIssues).toHaveLength(1);
    expect(depIssues[0].severity).toBe("warning");
    expect(depIssues[0].message).toContain("no imports or links found");
  });

  test("unused dep suppressed when imports justify it (links extra only)", () => {
    // links says extra, but imports does NOT list it as extra → dep is justified by imports
    const report = lint(
      MANIFEST,
      makeImportResult({ components_with_source: ["api"] }),
      makeLinkResult({
        extra_deps: [{ from: "api", to: "auth" }],
      }),
      makeFreshnessReport(),
    );
    const depIssues = report.issues.filter((i) => i.category === "deps");
    expect(depIssues).toHaveLength(0);
  });

  test("unused dep suppressed when links justify it (imports extra only)", () => {
    // imports says extra, but links does NOT list it as extra → dep is justified by links
    const report = lint(
      MANIFEST,
      makeImportResult({
        extra_deps: [{ from: "api", to: "auth" }],
        components_with_source: ["api"],
      }),
      makeLinkResult(),
      makeFreshnessReport(),
    );
    const depIssues = report.issues.filter((i) => i.category === "deps");
    expect(depIssues).toHaveLength(0);
  });

  test("unused import deps suppressed when component has no source files", () => {
    // Component has no source → import signal is absent → only link signal applies → no composed warning
    const report = lint(
      MANIFEST,
      makeImportResult({
        extra_deps: [{ from: "api", to: "auth" }],
        components_with_source: [],
      }),
      makeLinkResult({
        extra_deps: [{ from: "api", to: "auth" }],
      }),
      makeFreshnessReport(),
    );
    const depIssues = report.issues.filter((i) => i.category === "deps");
    expect(depIssues).toHaveLength(0);
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
        components_with_source: ["api", "auth"],
      }),
      makeLinkResult({
        extra_deps: [
          { from: "api", to: "auth" },
          { from: "auth", to: "api" },
        ],
      }),
      makeFreshnessReport(),
    );
    expect(report.total_issues).toBe(report.issues.length);
    expect(report.total_issues).toBe(2);
  });

  test("stable component without test field produces stability warning", () => {
    const stableManifest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: "/project/src/auth", stability: "stable", docs: [] },
        api: { path: "/project/src/api", stability: "stable", test: "bun test src/api", docs: [] },
      },
    };
    const report = lint(
      stableManifest,
      makeImportResult(),
      makeLinkResult(),
      makeFreshnessReport(),
    );
    const stabilityIssues = report.issues.filter((i) => i.category === "stability");
    expect(stabilityIssues).toHaveLength(1);
    expect(stabilityIssues[0].severity).toBe("warning");
    expect(stabilityIssues[0].component).toBe("auth");
    expect(stabilityIssues[0].message).toContain("no explicit test command");
  });

  test("experimental dep of stable component produces stability warning", () => {
    const mixedManifest: Manifest = {
      varp: "0.1.0",
      components: {
        core: { path: "/project/src/core", stability: "experimental", test: "bun test", docs: [] },
        api: {
          path: "/project/src/api",
          stability: "stable",
          test: "bun test",
          deps: ["core"],
          docs: [],
        },
      },
    };
    const report = lint(mixedManifest, makeImportResult(), makeLinkResult(), makeFreshnessReport());
    const stabilityIssues = report.issues.filter((i) => i.category === "stability");
    expect(stabilityIssues).toHaveLength(1);
    expect(stabilityIssues[0].component).toBe("core");
    expect(stabilityIssues[0].message).toContain("Experimental");
    expect(stabilityIssues[0].message).toContain("api");
  });

  test("no stability warnings when all components have test and matching stability", () => {
    const cleanManifest: Manifest = {
      varp: "0.1.0",
      components: {
        auth: { path: "/project/src/auth", stability: "stable", test: "bun test auth", docs: [] },
        api: {
          path: "/project/src/api",
          stability: "stable",
          test: "bun test api",
          deps: ["auth"],
          docs: [],
        },
      },
    };
    const report = lint(cleanManifest, makeImportResult(), makeLinkResult(), makeFreshnessReport());
    const stabilityIssues = report.issues.filter((i) => i.category === "stability");
    expect(stabilityIssues).toHaveLength(0);
  });

  // ── Suppressions ──

  test("suppressed warnings are filtered out", () => {
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
            docs: {},
            source_last_modified: "2026-02-15T00:00:00.000Z",
          },
        },
      }),
      // Suppress the freshness warning by its key
      {
        'freshness:auth:Stale doc: "README" in component "auth" (last modified: *)':
          "2026-02-19T00:00:00.000Z",
      },
    );
    expect(report.total_issues).toBe(0);
  });

  test("suppressions do not filter errors", () => {
    const importResult = makeImportResult({
      missing_deps: [
        {
          from: "auth",
          to: "api",
          evidence: [{ source_file: "/src/auth/index.ts", import_specifier: "../api/client.js" }],
        },
      ],
    });
    // Generate the issue to get its key
    const unsuppressed = lint(MANIFEST, importResult, makeLinkResult(), makeFreshnessReport());
    const key = issueKey(unsuppressed.issues[0]);

    const suppressed = lint(MANIFEST, importResult, makeLinkResult(), makeFreshnessReport(), {
      [key]: "2026-02-19T00:00:00.000Z",
    });
    // Error should still be present
    expect(suppressed.total_issues).toBe(1);
    expect(suppressed.issues[0].severity).toBe("error");
  });
});
