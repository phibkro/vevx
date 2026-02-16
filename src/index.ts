import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { parseManifest } from "./manifest/parser.js";
import { resolveDocs } from "./manifest/resolver.js";
import { invalidationCascade, validateDependencyGraph } from "./manifest/graph.js";
import { checkFreshness } from "./manifest/freshness.js";
import { detectHazards } from "./scheduler/hazards.js";
import { computeWaves } from "./scheduler/waves.js";
import { computeCriticalPath } from "./scheduler/critical-path.js";
import { parsePlanFile } from "./plan/parser.js";
import { validatePlan } from "./plan/validator.js";
import { verifyCapabilities } from "./enforcement/capabilities.js";
import { deriveRestartStrategy } from "./enforcement/restart.js";
import { TaskSchema } from "./types.js";

export function createServer(): McpServer {

const server = new McpServer({
  name: "varp",
  version: "0.1.0",
});

// ── Manifest Tools ──

server.tool(
  "varp_read_manifest",
  "Parse and validate varp.yaml. Returns typed manifest with component registry, dependency graph, and doc references.",
  { manifest_path: z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)") },
  async ({ manifest_path }) => {
    try {
      const path = manifest_path ?? "./varp.yaml";
      const manifest = parseManifest(path);
      const graphResult = validateDependencyGraph(manifest);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ manifest, dependency_graph_valid: graphResult.valid, ...(graphResult.valid ? {} : { cycles: graphResult.cycles }) }, null, 2),
          },
        ],
      };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "varp_resolve_docs",
  "Given a task's touches declaration, returns doc paths to load. Writes get interface+internal, reads get interface only.",
  {
    manifest_path: z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)"),
    reads: z.array(z.string()).optional().describe("Components this task reads from"),
    writes: z.array(z.string()).optional().describe("Components this task writes to"),
  },
  async ({ manifest_path, reads, writes }) => {
    try {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      const docs = resolveDocs(manifest, { reads, writes });
      return { content: [{ type: "text" as const, text: JSON.stringify(docs, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "varp_invalidation_cascade",
  "Given changed components, walks depends_on to return all transitively affected components.",
  {
    manifest_path: z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)"),
    changed: z.array(z.string()).describe("Component names whose interface docs changed"),
  },
  async ({ manifest_path, changed }) => {
    try {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      const affected = invalidationCascade(manifest, changed);
      return { content: [{ type: "text" as const, text: JSON.stringify({ affected }, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "varp_check_freshness",
  "Returns freshness status for all component docs — last modified timestamps, staleness relative to source.",
  { manifest_path: z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)") },
  async ({ manifest_path }) => {
    try {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      const report = checkFreshness(manifest);
      return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// ── Plan Tools ──

server.tool(
  "varp_parse_plan",
  "Parse plan.xml and return typed plan with metadata, contracts, task graph, and budgets.",
  { path: z.string().describe("Path to plan.xml") },
  async ({ path }) => {
    try {
      const plan = parsePlanFile(path);
      return { content: [{ type: "text" as const, text: JSON.stringify(plan, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "varp_validate_plan",
  "Check plan consistency against manifest: touches reference known components, unique task IDs, valid budgets.",
  {
    plan_path: z.string().describe("Path to plan.xml"),
    manifest_path: z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)"),
  },
  async ({ plan_path, manifest_path }) => {
    try {
      const plan = parsePlanFile(plan_path);
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      const result = validatePlan(plan, manifest);
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// ── Scheduler Tools ──

const TaskInputSchema = z.object({
  id: z.string(),
  description: z.string(),
  action: z.string(),
  values: z.array(z.string()),
  touches: z.object({
    reads: z.array(z.string()).optional(),
    writes: z.array(z.string()).optional(),
  }),
  budget: z.object({
    tokens: z.number().positive(),
    minutes: z.number().positive(),
  }),
});

server.tool(
  "varp_compute_waves",
  "Group tasks into execution waves based on data dependencies. Tasks within a wave are safe to run in parallel.",
  { tasks: z.array(TaskInputSchema).describe("Tasks with touches declarations") },
  async ({ tasks }) => {
    try {
      const waves = computeWaves(tasks);
      return { content: [{ type: "text" as const, text: JSON.stringify(waves, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "varp_detect_hazards",
  "Return all data hazards (RAW/WAR/WAW) between tasks.",
  { tasks: z.array(TaskInputSchema).describe("Tasks with touches declarations") },
  async ({ tasks }) => {
    try {
      const hazards = detectHazards(tasks);
      return { content: [{ type: "text" as const, text: JSON.stringify(hazards, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "varp_compute_critical_path",
  "Return the longest chain of RAW dependencies — the critical path for execution scheduling.",
  { tasks: z.array(TaskInputSchema).describe("Tasks with touches declarations") },
  async ({ tasks }) => {
    try {
      const criticalPath = computeCriticalPath(tasks);
      return { content: [{ type: "text" as const, text: JSON.stringify(criticalPath, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

// ── Enforcement Tools ──

server.tool(
  "varp_verify_capabilities",
  "Check that file modifications fall within the declared touches write set. Returns violations for out-of-scope writes.",
  {
    manifest_path: z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)"),
    reads: z.array(z.string()).optional().describe("Components declared as reads"),
    writes: z.array(z.string()).optional().describe("Components declared as writes"),
    diff_paths: z.array(z.string()).describe("File paths that were modified"),
  },
  async ({ manifest_path, reads, writes, diff_paths }) => {
    try {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      const report = verifyCapabilities(manifest, { reads, writes }, diff_paths);
      return { content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

server.tool(
  "varp_derive_restart_strategy",
  "Given a failed task and execution state, derive restart strategy: isolated_retry, cascade_restart, or escalate.",
  {
    failed_task: TaskInputSchema.describe("The task that failed"),
    all_tasks: z.array(TaskInputSchema).describe("All tasks in the plan"),
    completed_task_ids: z.array(z.string()).describe("IDs of completed tasks"),
    dispatched_task_ids: z.array(z.string()).describe("IDs of currently dispatched tasks"),
  },
  async ({ failed_task, all_tasks, completed_task_ids, dispatched_task_ids }) => {
    try {
      const strategy = deriveRestartStrategy(failed_task, all_tasks, completed_task_ids, dispatched_task_ids);
      return { content: [{ type: "text" as const, text: JSON.stringify(strategy, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text" as const, text: `Error: ${e instanceof Error ? e.message : String(e)}` }], isError: true };
    }
  },
);

return server;

} // end createServer

// ── Start Server ──

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
