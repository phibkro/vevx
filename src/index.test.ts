import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./index.js";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const MANIFEST_PATH = join(import.meta.dir, "..", "test-fixtures", "multi-component.yaml");
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
      <budget tokens="30000" minutes="10" />
    </task>
    <task id="2">
      <description>Update API layer</description>
      <action>implement</action>
      <values>correctness</values>
      <touches writes="api" reads="auth" />
      <budget tokens="20000" minutes="8" />
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

  test("lists all 14 tools", async () => {
    const result = await client.listTools();
    const names = result.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "varp_check_freshness",
      "varp_compute_critical_path",
      "varp_compute_waves",
      "varp_derive_restart_strategy",
      "varp_detect_hazards",
      "varp_infer_imports",
      "varp_invalidation_cascade",
      "varp_parse_plan",
      "varp_read_manifest",
      "varp_resolve_docs",
      "varp_scan_links",
      "varp_suggest_touches",
      "varp_validate_plan",
      "varp_verify_capabilities",
    ]);
  });

  // ── Manifest Tools ──

  test("varp_read_manifest parses manifest and validates dependency graph", async () => {
    const result = await client.callTool({
      name: "varp_read_manifest",
      arguments: { manifest_path: MANIFEST_PATH },
    });
    const data = parseResult(result);
    expect(data.dependency_graph_valid).toBe(true);
    expect(Object.keys(data.manifest.components)).toEqual(["auth", "api", "web"]);
  });

  test("varp_read_manifest returns error for missing file", async () => {
    const result = await client.callTool({
      name: "varp_read_manifest",
      arguments: { manifest_path: "/nonexistent/varp.yaml" },
    });
    expect(result.isError).toBe(true);
    expect((result.content[0] as any).text).toContain("Error");
  });

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

  test("varp_check_freshness returns freshness report for all components", async () => {
    const result = await client.callTool({
      name: "varp_check_freshness",
      arguments: { manifest_path: MANIFEST_PATH },
    });
    const data = parseResult(result);
    expect(Object.keys(data.components).sort()).toEqual(["api", "auth", "web"]);
    for (const comp of Object.values(data.components) as any[]) {
      expect(comp).toHaveProperty("docs");
      expect(comp).toHaveProperty("source_last_modified");
    }
  });

  // ── Plan Tools ──

  test("varp_parse_plan parses XML with touches and budgets", async () => {
    const result = await client.callTool({
      name: "varp_parse_plan",
      arguments: { path: TEST_PLAN_PATH },
    });
    const data = parseResult(result);
    expect(data.metadata.feature).toBe("Test Feature");
    expect(data.tasks).toHaveLength(2);
    expect(data.tasks[0].touches.writes).toEqual(["auth"]);
    expect(data.tasks[0].touches.reads).toEqual(["api"]);
    expect(data.tasks[0].budget).toEqual({ tokens: 30000, minutes: 10 });
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
      description: "impl auth",
      action: "implement",
      values: ["correctness"],
      touches: { writes: ["auth"] },
      budget: { tokens: 30000, minutes: 10 },
    },
    {
      id: "2",
      description: "impl api",
      action: "implement",
      values: ["correctness"],
      touches: { writes: ["api"], reads: ["auth"] },
      budget: { tokens: 20000, minutes: 8 },
    },
    {
      id: "3",
      description: "impl web",
      action: "implement",
      values: ["correctness"],
      touches: { writes: ["web"], reads: ["api"] },
      budget: { tokens: 25000, minutes: 12 },
    },
  ];

  test("varp_detect_hazards finds RAW hazards in dependent tasks", async () => {
    const result = await client.callTool({
      name: "varp_detect_hazards",
      arguments: { tasks: sampleTasks },
    });
    const data = parseResult(result);
    const rawHazards = data.filter((h: any) => h.type === "RAW");
    expect(rawHazards.length).toBeGreaterThanOrEqual(2);
    // task 1 writes auth, task 2 reads auth
    expect(
      rawHazards.some(
        (h: any) => h.source_task_id === "1" && h.target_task_id === "2" && h.component === "auth",
      ),
    ).toBe(true);
    // task 2 writes api, task 3 reads api
    expect(
      rawHazards.some(
        (h: any) => h.source_task_id === "2" && h.target_task_id === "3" && h.component === "api",
      ),
    ).toBe(true);
  });

  test("varp_compute_waves sequences dependent tasks into waves", async () => {
    const result = await client.callTool({
      name: "varp_compute_waves",
      arguments: { tasks: sampleTasks },
    });
    const data = parseResult(result);
    expect(data.length).toBe(3);
    expect(data[0].tasks.map((t: any) => t.id)).toEqual(["1"]);
    expect(data[1].tasks.map((t: any) => t.id)).toEqual(["2"]);
    expect(data[2].tasks.map((t: any) => t.id)).toEqual(["3"]);
  });

  test("varp_compute_critical_path returns longest RAW chain", async () => {
    const result = await client.callTool({
      name: "varp_compute_critical_path",
      arguments: { tasks: sampleTasks },
    });
    const data = parseResult(result);
    expect(data.task_ids).toEqual(["1", "2", "3"]);
    expect(data.total_budget.tokens).toBe(75000);
    expect(data.total_budget.minutes).toBe(30);
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
});
