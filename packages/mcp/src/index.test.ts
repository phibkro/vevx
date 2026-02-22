import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createServer } from "./index.js";

const MANIFEST_PATH = join(import.meta.dir, "..", "test-fixtures", "multi-component.yaml");
const MULTI_PATH_MANIFEST = join(import.meta.dir, "..", "test-fixtures", "multi-path.yaml");
const PLAN_DIR = join(import.meta.dir, "..", "test-fixtures");

// Write a test plan.xml for plan tool tests
const TEST_PLAN_PATH = join(PLAN_DIR, "test-plan.xml");
const TEST_PLAN_XML = `<plan>
  <metadata>
    <feature>Test Feature</feature>
    <created>2026-02-16</created>
  </metadata>
  <contract>
    <preconditions>
      <condition id="pre-1">
        <description>Source exists</description>
        <verify>test -d src</verify>
      </condition>
    </preconditions>
    <invariants>
      <invariant critical="true">
        <description>Tests pass</description>
        <verify>bun test</verify>
      </invariant>
    </invariants>
    <postconditions>
      <condition id="post-1">
        <description>Feature works</description>
        <verify>bun test --filter=feature</verify>
      </condition>
    </postconditions>
  </contract>
  <tasks>
    <task id="1">
      <description>Implement auth changes</description>
      <action>implement</action>
      <values>correctness, simplicity</values>
      <touches writes="auth" reads="api" />
    </task>
    <task id="2">
      <description>Update API layer</description>
      <action>implement</action>
      <values>correctness</values>
      <touches writes="api" reads="auth" />
    </task>
  </tasks>
</plan>`;

function parseResult(result: any): any {
  return JSON.parse(result.content[0].text);
}

describe("MCP server integration", () => {
  let client: Client;
  let cleanup: () => Promise<void>;

  beforeAll(async () => {
    writeFileSync(TEST_PLAN_PATH, TEST_PLAN_XML);

    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "test-client", version: "1.0.0" });

    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    cleanup = async () => {
      await Promise.all([server.close(), client.close()]);
    };
  });

  afterAll(async () => {
    await cleanup();
    // Clean up test plan
    try {
      require("fs").unlinkSync(TEST_PLAN_PATH);
    } catch {}
  });

  test("lists all tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "varp_ack_freshness",
      "varp_build_codebase_graph",
      "varp_check_env",
      "varp_check_warm_staleness",
      "varp_coupling",
      "varp_derive_restart_strategy",
      "varp_diff_plan",
      "varp_health",
      "varp_infer_imports",
      "varp_invalidation_cascade",
      "varp_list_files",
      "varp_parse_log",
      "varp_parse_plan",
      "varp_render_graph",
      "varp_resolve_docs",
      "varp_scan_links",
      "varp_schedule",
      "varp_scoped_tests",
      "varp_suggest_components",
      "varp_suggest_touches",
      "varp_validate_plan",
      "varp_verify_capabilities",
      "varp_watch_freshness",
    ]);
  });

  // ── Output Schema ──

  test("tools with outputSchema are listed with output schema", async () => {
    const result = await client.listTools();
    const withOutput = result.tools.filter((t) => t.outputSchema);
    const names = withOutput.map((t) => t.name).sort();
    expect(names).toEqual([
      "varp_ack_freshness",
      "varp_check_env",
      "varp_invalidation_cascade",
      "varp_list_files",
      "varp_verify_capabilities",
    ]);
  });

  // ── Annotations ──

  test("all tools have annotations", async () => {
    const result = await client.listTools();
    for (const tool of result.tools) {
      expect(tool.annotations).toBeDefined();
      expect(typeof tool.annotations!.readOnlyHint).toBe("boolean");
      expect(tool.annotations!.destructiveHint).toBe(false);
      expect(tool.annotations!.openWorldHint).toBe(false);
    }
  });

  test("varp_ack_freshness is not read-only", async () => {
    const result = await client.listTools();
    const ack = result.tools.find((t) => t.name === "varp_ack_freshness")!;
    expect(ack.annotations!.readOnlyHint).toBe(false);
  });

  // ── Health Tools ──

  test("varp_health mode=all returns manifest, freshness, and lint", async () => {
    const result = await client.callTool({
      name: "varp_health",
      arguments: { manifest_path: MANIFEST_PATH },
    });
    const data = parseResult(result);
    expect(data.manifest.dependency_graph_valid).toBe(true);
    expect(Object.keys(data.manifest.manifest.components)).toEqual(["auth", "api", "web"]);
    expect(Object.keys(data.freshness.components).sort()).toEqual(["api", "auth", "web"]);
    for (const comp of Object.values(data.freshness.components) as any[]) {
      expect(comp).toHaveProperty("docs");
      expect(comp).toHaveProperty("source_last_modified");
    }
    expect(data.lint).toHaveProperty("total_issues");
    expect(data.lint).toHaveProperty("issues");
    expect(typeof data.lint.total_issues).toBe("number");
    expect(data.lint.total_issues).toBe(data.lint.issues.length);
  });

  test("varp_health mode=manifest returns only manifest", async () => {
    const result = await client.callTool({
      name: "varp_health",
      arguments: { manifest_path: MANIFEST_PATH, mode: "manifest" },
    });
    const data = parseResult(result);
    expect(data.manifest.dependency_graph_valid).toBe(true);
    expect(data.freshness).toBeUndefined();
    expect(data.lint).toBeUndefined();
  });

  test("varp_health mode=freshness returns only freshness", async () => {
    const result = await client.callTool({
      name: "varp_health",
      arguments: { manifest_path: MANIFEST_PATH, mode: "freshness" },
    });
    const data = parseResult(result);
    expect(data.freshness).toBeDefined();
    expect(Object.keys(data.freshness.components).sort()).toEqual(["api", "auth", "web"]);
    expect(data.manifest).toBeUndefined();
    expect(data.lint).toBeUndefined();
  });

  test("varp_health mode=lint returns only lint", async () => {
    const result = await client.callTool({
      name: "varp_health",
      arguments: { manifest_path: MANIFEST_PATH, mode: "lint" },
    });
    const data = parseResult(result);
    expect(data.lint).toHaveProperty("total_issues");
    expect(data.lint).toHaveProperty("issues");
    for (const issue of data.lint.issues) {
      expect(["error", "warning"]).toContain(issue.severity);
      expect(typeof issue.message).toBe("string");
    }
    expect(data.manifest).toBeUndefined();
    expect(data.freshness).toBeUndefined();
  });

  test("varp_health returns error for missing file", async () => {
    const result = await client.callTool({
      name: "varp_health",
      arguments: { manifest_path: "/nonexistent/varp.yaml" },
    });
    expect(result.isError).toBe(true);
    expect((result.content as any)[0].text).toContain("Error");
  });

  // ── Manifest Tools ──

  test("varp_resolve_docs returns all docs for writes, README only for reads", async () => {
    const result = await client.callTool({
      name: "varp_resolve_docs",
      arguments: { manifest_path: MANIFEST_PATH, writes: ["auth"], reads: ["api"] },
    });
    const data = parseResult(result);
    // writes: auth → gets all docs; reads: api → gets README only
    const docs = data.docs as { component: string; doc: string; path: string }[];
    const authDocs = docs.filter((d) => d.component === "auth").map((d) => d.doc);
    const apiDocs = docs.filter((d) => d.component === "api").map((d) => d.doc);
    expect(authDocs).toContain("README");
    expect(authDocs).toContain("internal");
    expect(apiDocs).toContain("README");
    expect(apiDocs).not.toContain("internal");
  });

  test("varp_invalidation_cascade returns transitively affected components", async () => {
    const result = await client.callTool({
      name: "varp_invalidation_cascade",
      arguments: { manifest_path: MANIFEST_PATH, changed: ["auth"] },
    });
    const data = parseResult(result);
    expect(data.affected.sort()).toEqual(["api", "auth", "web"]);
  });

  // ── Plan Tools ──

  test("varp_parse_plan parses XML with touches", async () => {
    const result = await client.callTool({
      name: "varp_parse_plan",
      arguments: { path: TEST_PLAN_PATH },
    });
    const data = parseResult(result);
    expect(data.metadata.feature).toBe("Test Feature");
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks[0].touches.writes).toEqual(["auth"]);
    expect(data.tasks[0].touches.reads).toEqual(["api"]);
    expect(data.contract.invariants[0].critical).toBe(true);
  });

  test("varp_validate_plan validates plan against manifest", async () => {
    const result = await client.callTool({
      name: "varp_validate_plan",
      arguments: { plan_path: TEST_PLAN_PATH, manifest_path: MANIFEST_PATH },
    });
    const data = parseResult(result);
    expect(data.valid).toBe(true);
    expect(data.errors).toEqual([]);
  });

  // ── Scheduler Tools ──

  const sampleTasks = [
    {
      id: "1",
      touches: { writes: ["auth"] },
    },
    {
      id: "2",
      touches: { writes: ["api"], reads: ["auth"] },
    },
    {
      id: "3",
      touches: { writes: ["web"], reads: ["api"] },
    },
  ];

  test("varp_schedule mode=all returns waves, hazards, and critical_path", async () => {
    const result = await client.callTool({
      name: "varp_schedule",
      arguments: { tasks: sampleTasks },
    });
    const data = parseResult(result);
    expect(data.waves).toHaveLength(3);
    expect(data.waves[0].tasks.map((t: any) => t.id)).toEqual(["1"]);
    const rawHazards = data.hazards.filter((h: any) => h.type === "RAW");
    expect(rawHazards.length).toBeGreaterThanOrEqual(2);
    expect(data.critical_path.task_ids).toEqual(["1", "2", "3"]);
    expect(data.critical_path.length).toBe(3);
  });

  test("varp_schedule mode=waves returns only waves", async () => {
    const result = await client.callTool({
      name: "varp_schedule",
      arguments: { tasks: sampleTasks, mode: "waves" },
    });
    const data = parseResult(result);
    expect(data.waves).toHaveLength(3);
    expect(data.hazards).toBeUndefined();
    expect(data.critical_path).toBeUndefined();
  });

  test("varp_schedule mode=hazards returns only hazards", async () => {
    const result = await client.callTool({
      name: "varp_schedule",
      arguments: { tasks: sampleTasks, mode: "hazards" },
    });
    const data = parseResult(result);
    expect(data.hazards.length).toBeGreaterThan(0);
    expect(data.waves).toBeUndefined();
    expect(data.critical_path).toBeUndefined();
  });

  // ── Enforcement Tools ──

  test("varp_verify_capabilities flags out-of-scope writes", async () => {
    // Paths must be relative to the manifest's resolved component paths (test-fixtures/src/...)
    const result = await client.callTool({
      name: "varp_verify_capabilities",
      arguments: {
        manifest_path: MANIFEST_PATH,
        writes: ["auth"],
        diff_paths: [join(PLAN_DIR, "src/auth/index.ts"), join(PLAN_DIR, "src/api/routes.ts")],
      },
    });
    const data = parseResult(result);
    expect(data.valid).toBe(false);
    expect(data.violations).toHaveLength(1);
    expect(data.violations[0].actual_component).toBe("api");
  });

  test("varp_verify_capabilities passes for in-scope writes", async () => {
    const result = await client.callTool({
      name: "varp_verify_capabilities",
      arguments: {
        manifest_path: MANIFEST_PATH,
        writes: ["auth", "api"],
        diff_paths: [join(PLAN_DIR, "src/auth/index.ts"), join(PLAN_DIR, "src/api/routes.ts")],
      },
    });
    const data = parseResult(result);
    expect(data.valid).toBe(true);
    expect(data.violations).toHaveLength(0);
  });

  test("varp_derive_restart_strategy returns isolated_retry when no downstream consumers", async () => {
    const result = await client.callTool({
      name: "varp_derive_restart_strategy",
      arguments: {
        failed_task: sampleTasks[2], // task 3 writes web, no one reads web
        all_tasks: sampleTasks,
        completed_task_ids: ["1", "2"],
        dispatched_task_ids: [],
      },
    });
    const data = parseResult(result);
    expect(data.strategy).toBe("isolated_retry");
  });

  test("varp_derive_restart_strategy returns escalate when completed tasks consumed output", async () => {
    const result = await client.callTool({
      name: "varp_derive_restart_strategy",
      arguments: {
        failed_task: sampleTasks[0], // task 1 writes auth
        all_tasks: sampleTasks,
        completed_task_ids: ["2"], // task 2 reads auth and is completed
        dispatched_task_ids: [],
      },
    });
    const data = parseResult(result);
    expect(data.strategy).toBe("escalate");
  });

  // ── Link Scanner ──

  const LINK_SCAN_MANIFEST = join(import.meta.dir, "..", "test-fixtures", "link-scan", "varp.yaml");

  test("varp_scan_links with mode=all returns broken links and inferred deps", async () => {
    const result = await client.callTool({
      name: "varp_scan_links",
      arguments: { manifest_path: LINK_SCAN_MANIFEST, mode: "all" },
    });
    const data = parseResult(result);
    expect(data.total_docs_scanned).toBeGreaterThan(0);
    expect(data.total_links_scanned).toBeGreaterThan(0);
    expect(data.broken_links.length).toBeGreaterThan(0);
    expect(data.inferred_deps.length).toBeGreaterThan(0);
  });

  test("varp_scan_links with mode=integrity returns broken links only", async () => {
    const result = await client.callTool({
      name: "varp_scan_links",
      arguments: { manifest_path: LINK_SCAN_MANIFEST, mode: "integrity" },
    });
    const data = parseResult(result);
    expect(data.broken_links.length).toBeGreaterThan(0);
    // In integrity mode, deps are still returned (empty) but not actively checked
    expect(data.total_links_scanned).toBeGreaterThan(0);
  });

  // ── Import Scanner ──

  test("varp_infer_imports returns import scan result with expected structure", async () => {
    const result = await client.callTool({
      name: "varp_infer_imports",
      arguments: { manifest_path: MANIFEST_PATH },
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("import_deps");
    expect(data).toHaveProperty("missing_deps");
    expect(data).toHaveProperty("extra_deps");
    expect(data).toHaveProperty("total_files_scanned");
    expect(data).toHaveProperty("total_imports_scanned");
    expect(Array.isArray(data.import_deps)).toBe(true);
    expect(Array.isArray(data.missing_deps)).toBe(true);
    expect(Array.isArray(data.extra_deps)).toBe(true);
    expect(typeof data.total_files_scanned).toBe("number");
    expect(typeof data.total_imports_scanned).toBe("number");
  });

  test("varp_suggest_touches returns writes and reads for file paths", async () => {
    const result = await client.callTool({
      name: "varp_suggest_touches",
      arguments: {
        manifest_path: MANIFEST_PATH,
        file_paths: [join(PLAN_DIR, "src/api/routes.ts")],
      },
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("writes");
    expect(data.writes).toContain("api");
  });

  // ── List Files ──

  test("varp_list_files returns source files for components", async () => {
    const result = await client.callTool({
      name: "varp_list_files",
      arguments: { manifest_path: MANIFEST_PATH, components: ["auth"] },
    });
    const data = parseResult(result);
    expect(data.files).toHaveLength(1);
    expect(data.files[0].component).toBe("auth");
    expect(data.files[0].paths.length).toBeGreaterThan(0);
    expect(typeof data.total).toBe("number");
    expect(data.total).toBe(data.files[0].paths.length);
  });

  test("varp_list_files resolves tags to components", async () => {
    const result = await client.callTool({
      name: "varp_list_files",
      arguments: { manifest_path: MANIFEST_PATH, components: ["security"] },
    });
    const data = parseResult(result);
    // "security" tag resolves to auth component (which has tags: [security, api-boundary])
    expect(data.files.length).toBeGreaterThanOrEqual(1);
    expect(data.files.some((f: any) => f.component === "auth")).toBe(true);
  });

  // ── Plan Diff ──

  test("varp_diff_plan returns empty diff for identical plans", async () => {
    const result = await client.callTool({
      name: "varp_diff_plan",
      arguments: { plan_a_path: TEST_PLAN_PATH, plan_b_path: TEST_PLAN_PATH },
    });
    const data = parseResult(result);
    expect(data.metadata).toEqual([]);
    expect(data.contracts).toEqual([]);
    expect(data.tasks).toEqual([]);
  });

  test("varp_diff_plan detects differences between two plans", async () => {
    // Create a second plan with differences
    const planB = join(PLAN_DIR, "test-plan-b.xml");
    writeFileSync(
      planB,
      `<plan>
  <metadata>
    <feature>Modified Feature</feature>
    <created>2026-02-17</created>
  </metadata>
  <contract>
    <preconditions>
      <condition id="pre-1">
        <description>Source exists</description>
        <verify>test -d src</verify>
      </condition>
    </preconditions>
    <invariants>
      <invariant critical="true">
        <description>Tests pass</description>
        <verify>bun test</verify>
      </invariant>
    </invariants>
    <postconditions>
      <condition id="post-1">
        <description>Feature works</description>
        <verify>bun test --filter=feature</verify>
      </condition>
    </postconditions>
  </contract>
  <tasks>
    <task id="1">
      <description>Implement auth changes v2</description>
      <action>implement</action>
      <values>correctness, simplicity</values>
      <touches writes="auth" reads="api" />
    </task>
    <task id="3">
      <description>New task</description>
      <action>test</action>
      <values>coverage</values>
      <touches reads="auth" />
    </task>
  </tasks>
</plan>`,
    );

    try {
      const result = await client.callTool({
        name: "varp_diff_plan",
        arguments: { plan_a_path: TEST_PLAN_PATH, plan_b_path: planB },
      });
      const data = parseResult(result);
      // Metadata changed
      expect(data.metadata.length).toBeGreaterThan(0);
      // Task 2 removed, task 3 added, task 1 modified
      const removed = data.tasks.filter((t: any) => t.type === "removed");
      const added = data.tasks.filter((t: any) => t.type === "added");
      const modified = data.tasks.filter((t: any) => t.type === "modified");
      expect(removed.some((t: any) => t.id === "2")).toBe(true);
      expect(added.some((t: any) => t.id === "3")).toBe(true);
      expect(modified.some((t: any) => t.id === "1")).toBe(true);
    } finally {
      try {
        require("fs").unlinkSync(planB);
      } catch {}
    }
  });

  test("varp_diff_plan returns error for missing file", async () => {
    const result = await client.callTool({
      name: "varp_diff_plan",
      arguments: { plan_a_path: TEST_PLAN_PATH, plan_b_path: "/nonexistent/plan.xml" },
    });
    expect(result.isError).toBe(true);
  });

  // ── Scoped Tests ──

  test("varp_scoped_tests returns test files for write components", async () => {
    const result = await client.callTool({
      name: "varp_scoped_tests",
      arguments: { manifest_path: MANIFEST_PATH, writes: ["auth"] },
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("test_files");
    expect(data).toHaveProperty("components_covered");
    expect(data).toHaveProperty("run_command");
    expect(data).toHaveProperty("custom_commands");
    expect(Array.isArray(data.test_files)).toBe(true);
    expect(data.components_covered).toContain("auth");
  });

  test("varp_scoped_tests returns required_env from component env fields", async () => {
    const result = await client.callTool({
      name: "varp_scoped_tests",
      arguments: { manifest_path: MANIFEST_PATH, writes: ["api"] },
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("required_env");
    expect(data.required_env).toEqual(["DATABASE_URL"]);
  });

  test("varp_scoped_tests returns empty required_env when no env fields", async () => {
    const result = await client.callTool({
      name: "varp_scoped_tests",
      arguments: { manifest_path: MANIFEST_PATH, writes: ["auth"] },
    });
    const data = parseResult(result);
    expect(data.required_env).toEqual([]);
  });

  test("varp_scoped_tests returns empty for reads by default", async () => {
    const result = await client.callTool({
      name: "varp_scoped_tests",
      arguments: { manifest_path: MANIFEST_PATH, reads: ["auth"] },
    });
    const data = parseResult(result);
    expect(data.test_files).toEqual([]);
    expect(data.components_covered).toEqual([]);
    expect(data.run_command).toBe("");
  });

  test("varp_scoped_tests with tags filter returns only matching components", async () => {
    const result = await client.callTool({
      name: "varp_scoped_tests",
      arguments: { manifest_path: MANIFEST_PATH, writes: ["auth", "web"], tags: ["security"] },
    });
    const data = parseResult(result);
    // auth has tags: [security, api-boundary], web has tags: [frontend]
    expect(data.components_covered).toEqual(["auth"]);
  });

  // ── Env Check ──

  test("varp_check_env returns set and missing env vars", async () => {
    const result = await client.callTool({
      name: "varp_check_env",
      arguments: { manifest_path: MANIFEST_PATH, components: ["api"] },
    });
    const data = parseResult(result);
    expect(data.required).toEqual(["DATABASE_URL"]);
    // DATABASE_URL may or may not be set in test env, just check structure
    expect(Array.isArray(data.set)).toBe(true);
    expect(Array.isArray(data.missing)).toBe(true);
    expect([...data.set, ...data.missing].sort((a, b) => a.localeCompare(b))).toEqual([
      "DATABASE_URL",
    ]);
  });

  test("varp_check_env returns empty for components without env", async () => {
    const result = await client.callTool({
      name: "varp_check_env",
      arguments: { manifest_path: MANIFEST_PATH, components: ["auth"] },
    });
    const data = parseResult(result);
    expect(data.required).toEqual([]);
    expect(data.set).toEqual([]);
    expect(data.missing).toEqual([]);
  });

  test("varp_scan_links with mode=deps returns dependency analysis", async () => {
    const result = await client.callTool({
      name: "varp_scan_links",
      arguments: { manifest_path: LINK_SCAN_MANIFEST, mode: "deps" },
    });
    const data = parseResult(result);
    expect(data.inferred_deps.length).toBeGreaterThan(0);
    // auth links to api but doesn't declare dep → should be in missing_deps
    const missingAuthToApi = data.missing_deps.find(
      (d: any) => d.from === "auth" && d.to === "api",
    );
    expect(missingAuthToApi).toBeDefined();
  });

  // ── Multi-Path Manifest ──

  test("varp_health with multi-path component returns array of resolved paths", async () => {
    const result = await client.callTool({
      name: "varp_health",
      arguments: { manifest_path: MULTI_PATH_MANIFEST, mode: "manifest" },
    });
    const data = parseResult(result);
    const auth = data.manifest.manifest.components.auth;
    expect(Array.isArray(auth.path)).toBe(true);
    expect(auth.path).toHaveLength(3);
    // All paths should be absolute
    for (const p of auth.path) {
      expect(p).toMatch(/^\//);
    }
  });

  test("varp_suggest_touches with files from different paths of same multi-path component", async () => {
    const result = await client.callTool({
      name: "varp_suggest_touches",
      arguments: {
        manifest_path: MULTI_PATH_MANIFEST,
        file_paths: [
          join(PLAN_DIR, "src/controllers/auth/login.ts"),
          join(PLAN_DIR, "src/services/auth/auth-service.ts"),
        ],
      },
    });
    const data = parseResult(result);
    expect(data.writes).toContain("auth");
    // Both files belong to the same component — should not duplicate
    expect(data.writes.filter((w: string) => w === "auth")).toHaveLength(1);
  });

  // ── Suggest Components ──

  test("varp_suggest_components with mode=domains detects domain-organized projects", async () => {
    const tmpDir = join("/tmp/claude", "suggest-domains-integration");
    rmSync(tmpDir, { recursive: true, force: true });

    mkdirSync(join(tmpDir, "auth/controllers"), { recursive: true });
    mkdirSync(join(tmpDir, "auth/services"), { recursive: true });
    writeFileSync(join(tmpDir, "auth/controllers/login.ts"), "");
    writeFileSync(join(tmpDir, "auth/services/auth.ts"), "");

    try {
      const result = await client.callTool({
        name: "varp_suggest_components",
        arguments: { root_dir: tmpDir, mode: "domains" },
      });
      const data = parseResult(result);
      expect(data.components).toHaveLength(1);
      expect(data.components[0].name).toBe("auth");
      expect(data.components[0].path).toEqual(["auth/controllers", "auth/services"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test("varp_suggest_components returns suggestions for layer-organized project", async () => {
    const tmpDir = join("/tmp/claude", "suggest-components-integration");
    rmSync(tmpDir, { recursive: true, force: true });

    // Create layer structure
    mkdirSync(join(tmpDir, "controllers"), { recursive: true });
    mkdirSync(join(tmpDir, "services"), { recursive: true });
    writeFileSync(join(tmpDir, "controllers/user.controller.ts"), "");
    writeFileSync(join(tmpDir, "services/user.service.ts"), "");

    try {
      const result = await client.callTool({
        name: "varp_suggest_components",
        arguments: { root_dir: tmpDir },
      });
      const data = parseResult(result);
      expect(data.components).toHaveLength(1);
      expect(data.components[0].name).toBe("user");
      expect(data.components[0].path).toEqual(["controllers", "services"]);
      expect(data.layer_dirs_scanned).toEqual(["controllers", "services"]);
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  // ── Parse Log ──

  test("varp_parse_log parses execution log XML", async () => {
    const logPath = join(PLAN_DIR, "test-log.xml");
    const result = await client.callTool({
      name: "varp_parse_log",
      arguments: { path: logPath },
    });
    const data = parseResult(result);
    expect(data.session.mode).toBe("sequential");
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks[0].id).toBe("1");
    expect(data.tasks[0].status).toBe("COMPLETE");
    expect(data.tasks[0].metrics.tokens).toBe(25000);
    expect(data.tasks[0].files_modified).toEqual(["src/auth/login.ts", "src/auth/session.ts"]);
    expect(data.tasks[1].status).toBe("PARTIAL");
    expect(data.invariant_checks).toHaveLength(2);
    expect(data.waves).toHaveLength(2);
  });

  test("varp_parse_log returns error for missing file", async () => {
    const result = await client.callTool({
      name: "varp_parse_log",
      arguments: { path: "/nonexistent/log.xml" },
    });
    expect(result.isError).toBe(true);
  });

  // ── Render Graph ──

  test("varp_render_graph returns Mermaid diagram", async () => {
    const result = await client.callTool({
      name: "varp_render_graph",
      arguments: { manifest_path: MANIFEST_PATH },
    });
    const data = parseResult(result);
    expect(data.mermaid).toContain("graph TD");
    expect(data.mermaid).toContain("auth");
    expect(data.mermaid).toContain("api");
    expect(data.mermaid).toContain("web");
  });

  test("varp_render_graph respects LR direction", async () => {
    const result = await client.callTool({
      name: "varp_render_graph",
      arguments: { manifest_path: MANIFEST_PATH, direction: "LR" },
    });
    const data = parseResult(result);
    expect(data.mermaid).toContain("graph LR");
  });

  // ── Watch Freshness ──

  test("varp_watch_freshness returns snapshot with changes and total_stale", async () => {
    const result = await client.callTool({
      name: "varp_watch_freshness",
      arguments: { manifest_path: MANIFEST_PATH },
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("changes");
    expect(data).toHaveProperty("snapshot_time");
    expect(data).toHaveProperty("total_stale");
    expect(Array.isArray(data.changes)).toBe(true);
    expect(typeof data.snapshot_time).toBe("string");
    expect(typeof data.total_stale).toBe("number");
  });

  test("varp_watch_freshness with since filters changes", async () => {
    // Use a future date — nothing should have changed
    const result = await client.callTool({
      name: "varp_watch_freshness",
      arguments: { manifest_path: MANIFEST_PATH, since: "2099-01-01T00:00:00Z" },
    });
    const data = parseResult(result);
    expect(data.changes).toEqual([]);
  });

  // ── Coupling Analysis ──

  test("varp_coupling mode=co_changes returns co-change graph structure", async () => {
    const result = await client.callTool({
      name: "varp_coupling",
      arguments: { manifest_path: MANIFEST_PATH, mode: "co_changes" },
    });
    const data = parseResult(result);
    expect(data.co_changes).toHaveProperty("edges");
    expect(data.co_changes).toHaveProperty("total_commits_analyzed");
    expect(Array.isArray(data.co_changes.edges)).toBe(true);
  });

  test("varp_coupling mode=neighborhood returns neighbors for a file", async () => {
    const result = await client.callTool({
      name: "varp_coupling",
      arguments: {
        manifest_path: MANIFEST_PATH,
        mode: "neighborhood",
        file: "src/auth/index.ts",
      },
    });
    const data = parseResult(result);
    expect(data.file).toBe("src/auth/index.ts");
    expect(data).toHaveProperty("neighbors");
    expect(data).toHaveProperty("trends");
    expect(data).toHaveProperty("total_neighbors");
    expect(Array.isArray(data.neighbors)).toBe(true);
  });

  test("varp_coupling mode=neighborhood requires file param", async () => {
    const result = await client.callTool({
      name: "varp_coupling",
      arguments: { manifest_path: MANIFEST_PATH, mode: "neighborhood" },
    });
    expect(result.isError).toBe(true);
  });

  test("varp_coupling mode=file_hotspots returns hotspot entries", async () => {
    const result = await client.callTool({
      name: "varp_coupling",
      arguments: { manifest_path: MANIFEST_PATH, mode: "file_hotspots", limit: 5 },
    });
    const data = parseResult(result);
    expect(data).toHaveProperty("hotspots");
    expect(data).toHaveProperty("total");
    expect(Array.isArray(data.hotspots)).toBe(true);
    expect(data.hotspots.length).toBeLessThanOrEqual(5);
    if (data.hotspots.length > 0) {
      expect(data.hotspots[0]).toHaveProperty("file");
      expect(data.hotspots[0]).toHaveProperty("score");
      expect(data.hotspots[0]).toHaveProperty("changeFrequency");
      expect(data.hotspots[0]).toHaveProperty("lineCount");
    }
  });

  // ── Warm Staleness ──

  test("varp_check_warm_staleness returns safe when no changes since baseline", async () => {
    const result = await client.callTool({
      name: "varp_check_warm_staleness",
      arguments: {
        manifest_path: MANIFEST_PATH,
        components: ["auth", "api"],
        since: "2099-01-01T00:00:00Z",
      },
    });
    const data = parseResult(result);
    expect(data.safe_to_resume).toBe(true);
    expect(data.stale_components).toEqual([]);
    expect(data.summary).toBe("No changes detected");
  });

  test("varp_check_warm_staleness detects stale components", async () => {
    // Create temp fixture with controlled mtimes
    const tmpDir = join("/tmp/claude", "warm-staleness-integration");
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(tmpDir, "comp-a"), { recursive: true });
    writeFileSync(join(tmpDir, "comp-a/source.ts"), "export const a = 1;");
    const sourceTime = new Date("2026-02-15T00:00:00Z");
    utimesSync(join(tmpDir, "comp-a/source.ts"), sourceTime, sourceTime);

    const manifestPath = join(tmpDir, "varp.yaml");
    writeFileSync(manifestPath, `varp: "0.1.0"\ncomp-a:\n  path: ./comp-a\n  docs: []\n`);

    try {
      const result = await client.callTool({
        name: "varp_check_warm_staleness",
        arguments: {
          manifest_path: manifestPath,
          components: ["comp-a"],
          since: "2026-01-01T00:00:00Z",
        },
      });
      const data = parseResult(result);
      expect(data.safe_to_resume).toBe(false);
      expect(data.stale_components).toHaveLength(1);
      expect(data.stale_components[0].component).toBe("comp-a");
      expect(data.summary).toContain("comp-a");
    } finally {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
