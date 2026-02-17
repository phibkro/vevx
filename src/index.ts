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
import { scanLinks, type LinkScanMode } from "./manifest/links.js";
import { registerTools, type ToolDef } from "./tool-registry.js";

// ── Shared Schemas ──

const manifestPath = z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)");

const TaskInputSchema = {
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
};

const tasksInput = { tasks: z.array(z.object(TaskInputSchema)).describe("Tasks with touches declarations") };

// ── Tool Definitions ──

const tools: ToolDef[] = [
  // Manifest
  {
    name: "varp_read_manifest",
    description: "Parse and validate varp.yaml. Returns typed manifest with component registry, dependency graph, and doc references.",
    inputSchema: { manifest_path: manifestPath },
    handler: async ({ manifest_path }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      const graphResult = validateDependencyGraph(manifest);
      return { manifest, dependency_graph_valid: graphResult.valid, ...(graphResult.valid ? {} : { cycles: graphResult.cycles }) };
    },
  },
  {
    name: "varp_resolve_docs",
    description: "Given a task's touches declaration, returns doc paths to load. Auto-discovers README.md (public) and docs/*.md (private) within component paths. Reads load public docs only. Writes load all docs.",
    inputSchema: {
      manifest_path: manifestPath,
      reads: z.array(z.string()).optional().describe("Components this task reads from"),
      writes: z.array(z.string()).optional().describe("Components this task writes to"),
    },
    handler: async ({ manifest_path, reads, writes }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return resolveDocs(manifest, { reads, writes });
    },
  },
  {
    name: "varp_invalidation_cascade",
    description: "Given changed components, walks deps to return all transitively affected components.",
    inputSchema: {
      manifest_path: manifestPath,
      changed: z.array(z.string()).describe("Component names whose interface docs changed"),
    },
    handler: async ({ manifest_path, changed }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return { affected: invalidationCascade(manifest, changed) };
    },
  },
  {
    name: "varp_check_freshness",
    description: "Returns freshness status for all component docs — last modified timestamps, staleness relative to source.",
    inputSchema: { manifest_path: manifestPath },
    handler: async ({ manifest_path }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return checkFreshness(manifest);
    },
  },

  // Plan
  {
    name: "varp_parse_plan",
    description: "Parse plan.xml and return typed plan with metadata, contracts, task graph, and budgets.",
    inputSchema: { path: z.string().describe("Path to plan.xml") },
    handler: async ({ path }) => parsePlanFile(path),
  },
  {
    name: "varp_validate_plan",
    description: "Check plan consistency against manifest: touches reference known components, unique task IDs, valid budgets.",
    inputSchema: {
      plan_path: z.string().describe("Path to plan.xml"),
      manifest_path: manifestPath,
    },
    handler: async ({ plan_path, manifest_path }) => {
      const plan = parsePlanFile(plan_path);
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return validatePlan(plan, manifest);
    },
  },

  // Scheduler
  {
    name: "varp_compute_waves",
    description: "Group tasks into execution waves based on data dependencies. Tasks within a wave are safe to run in parallel.",
    inputSchema: tasksInput,
    handler: async ({ tasks }) => computeWaves(tasks),
  },
  {
    name: "varp_detect_hazards",
    description: "Return all data hazards (RAW/WAR/WAW) between tasks.",
    inputSchema: tasksInput,
    handler: async ({ tasks }) => detectHazards(tasks),
  },
  {
    name: "varp_compute_critical_path",
    description: "Return the longest chain of RAW dependencies — the critical path for execution scheduling.",
    inputSchema: tasksInput,
    handler: async ({ tasks }) => computeCriticalPath(tasks),
  },

  // Link Scanner
  {
    name: "varp_scan_links",
    description: "Scan component docs for markdown links. Infer cross-component dependencies, detect broken links, and compare against declared deps.",
    inputSchema: {
      manifest_path: manifestPath,
      mode: z.enum(["deps", "integrity", "all"]).describe("deps: infer dependencies from links. integrity: find broken links. all: both."),
    },
    handler: async ({ manifest_path, mode }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return scanLinks(manifest, mode as LinkScanMode);
    },
  },

  // Enforcement
  {
    name: "varp_verify_capabilities",
    description: "Check that file modifications fall within the declared touches write set. Returns violations for out-of-scope writes.",
    inputSchema: {
      manifest_path: manifestPath,
      reads: z.array(z.string()).optional().describe("Components declared as reads"),
      writes: z.array(z.string()).optional().describe("Components declared as writes"),
      diff_paths: z.array(z.string()).describe("File paths that were modified"),
    },
    handler: async ({ manifest_path, reads, writes, diff_paths }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return verifyCapabilities(manifest, { reads, writes }, diff_paths);
    },
  },
  {
    name: "varp_derive_restart_strategy",
    description: "Given a failed task and execution state, derive restart strategy: isolated_retry, cascade_restart, or escalate.",
    inputSchema: {
      failed_task: z.object(TaskInputSchema).describe("The task that failed"),
      all_tasks: z.array(z.object(TaskInputSchema)).describe("All tasks in the plan"),
      completed_task_ids: z.array(z.string()).describe("IDs of completed tasks"),
      dispatched_task_ids: z.array(z.string()).describe("IDs of currently dispatched tasks"),
    },
    handler: async ({ failed_task, all_tasks, completed_task_ids, dispatched_task_ids }) => {
      return deriveRestartStrategy(failed_task, all_tasks, completed_task_ids, dispatched_task_ids);
    },
  },
];

// ── Server ──

export function createServer(): McpServer {
  const server = new McpServer({
    name: "varp",
    version: "0.1.0",
  });

  registerTools(server, tools);

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
