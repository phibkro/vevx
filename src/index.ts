import { dirname, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { verifyCapabilities } from "./enforcement/capabilities.js";
import { deriveRestartStrategy } from "./enforcement/restart.js";
import { checkEnv } from "./manifest/env-check.js";
import { checkFreshness } from "./manifest/freshness.js";
import { invalidationCascade, validateDependencyGraph } from "./manifest/graph.js";
import { scanImports } from "./manifest/imports.js";
import { scanLinks, type LinkScanMode } from "./manifest/links.js";
import { runLint } from "./manifest/lint.js";
import { parseManifest } from "./manifest/parser.js";
import { resolveDocs } from "./manifest/resolver.js";
import { findScopedTests } from "./manifest/scoped-tests.js";
import { suggestComponents } from "./manifest/suggest-components.js";
import { suggestTouches } from "./manifest/touches.js";
import { diffPlans } from "./plan/diff.js";
import { parsePlanFile } from "./plan/parser.js";
import { validatePlan } from "./plan/validator.js";
import { computeCriticalPath } from "./scheduler/critical-path.js";
import { detectHazards } from "./scheduler/hazards.js";
import { computeWaves } from "./scheduler/waves.js";
import { registerTools, type ToolDef } from "./tool-registry.js";

// ── Shared Schemas ──

const manifestPath = z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)");

const touchesSchema = z.object({
  reads: z.array(z.string()).optional(),
  writes: z.array(z.string()).optional(),
});

const budgetSchema = z.object({
  tokens: z.number().positive(),
  minutes: z.number().positive(),
});

const taskRefSchema = z.object({ id: z.string(), touches: touchesSchema });

const schedulableTaskSchema = z.object({
  id: z.string(),
  touches: touchesSchema,
  budget: budgetSchema,
});

const hazardTasksInput = {
  tasks: z.array(taskRefSchema).describe("Tasks with touches declarations"),
};

const schedulerTasksInput = {
  tasks: z.array(schedulableTaskSchema).describe("Tasks with touches declarations"),
};

// ── Tool Definitions ──

const tools: ToolDef[] = [
  // Manifest
  {
    name: "varp_read_manifest",
    description:
      "Parse and validate varp.yaml. Returns typed manifest with component registry, dependency graph, and doc references.",
    inputSchema: { manifest_path: manifestPath },
    handler: async ({ manifest_path }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      const graphResult = validateDependencyGraph(manifest);
      return {
        manifest,
        dependency_graph_valid: graphResult.valid,
        ...(graphResult.valid ? {} : { cycles: graphResult.cycles }),
      };
    },
  },
  {
    name: "varp_resolve_docs",
    description:
      "Given a task's touches declaration, returns doc paths to load. Auto-discovers README.md (public) and docs/*.md (private) within component paths. Reads load public docs only. Writes load all docs.",
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
    description:
      "Given changed components, walks deps to return all transitively affected components.",
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
    description:
      "Returns freshness status for all component docs — last modified timestamps, staleness relative to source.",
    inputSchema: { manifest_path: manifestPath },
    handler: async ({ manifest_path }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return checkFreshness(manifest);
    },
  },

  // Plan
  {
    name: "varp_parse_plan",
    description:
      "Parse plan.xml and return typed plan with metadata, contracts, task graph, and budgets.",
    inputSchema: { path: z.string().describe("Path to plan.xml") },
    handler: async ({ path }) => parsePlanFile(path),
  },
  {
    name: "varp_validate_plan",
    description:
      "Check plan consistency against manifest: touches reference known components, unique task IDs, valid budgets.",
    inputSchema: {
      plan_path: z.string().describe("Path to plan.xml"),
      manifest_path: manifestPath,
    },
    handler: async ({ plan_path, manifest_path }) => {
      const mp = manifest_path ?? "./varp.yaml";
      const plan = parsePlanFile(plan_path);
      const manifest = parseManifest(mp);
      const hazards = detectHazards(plan.tasks);
      const { import_deps } = scanImports(manifest, dirname(resolve(mp)));
      return validatePlan(plan, manifest, hazards, import_deps);
    },
  },

  // Scheduler
  {
    name: "varp_compute_waves",
    description:
      "Group tasks into execution waves based on data dependencies. Tasks within a wave are safe to run in parallel.",
    inputSchema: schedulerTasksInput,
    handler: async ({ tasks }) => computeWaves(tasks),
  },
  {
    name: "varp_detect_hazards",
    description: "Return all data hazards (RAW/WAR/WAW) between tasks.",
    inputSchema: hazardTasksInput,
    handler: async ({ tasks }) => detectHazards(tasks),
  },
  {
    name: "varp_compute_critical_path",
    description:
      "Return the longest chain of RAW dependencies — the critical path for execution scheduling.",
    inputSchema: schedulerTasksInput,
    handler: async ({ tasks }) => computeCriticalPath(tasks),
  },

  // Link Scanner
  {
    name: "varp_scan_links",
    description:
      "Scan component docs for markdown links. Infer cross-component dependencies, detect broken links, and compare against declared deps.",
    inputSchema: {
      manifest_path: manifestPath,
      mode: z
        .enum(["deps", "integrity", "all"])
        .describe("deps: infer dependencies from links. integrity: find broken links. all: both."),
    },
    handler: async ({ manifest_path, mode }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return scanLinks(manifest, mode as LinkScanMode);
    },
  },

  // Import Scanner
  {
    name: "varp_infer_imports",
    description:
      "Scan source files for import statements. Infer cross-component dependencies from static imports.",
    inputSchema: { manifest_path: manifestPath },
    handler: async ({ manifest_path }) => {
      const mp = manifest_path ?? "./varp.yaml";
      const manifest = parseManifest(mp);
      return scanImports(manifest, dirname(resolve(mp)));
    },
  },

  // Suggest Touches
  {
    name: "varp_suggest_touches",
    description:
      "Given file paths, suggest touches declaration using ownership mapping and import dependencies.",
    inputSchema: {
      manifest_path: manifestPath,
      file_paths: z.array(z.string()).describe("File paths that will be modified"),
    },
    handler: async ({ manifest_path, file_paths }) => {
      const mp = manifest_path ?? "./varp.yaml";
      const manifest = parseManifest(mp);
      const { import_deps } = scanImports(manifest, dirname(resolve(mp)));
      return suggestTouches(file_paths, manifest, import_deps);
    },
  },

  // Enforcement
  {
    name: "varp_verify_capabilities",
    description:
      "Check that file modifications fall within the declared touches write set. Returns violations for out-of-scope writes.",
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
    description:
      "Given a failed task and execution state, derive restart strategy: isolated_retry, cascade_restart, or escalate.",
    inputSchema: {
      failed_task: taskRefSchema.describe("The task that failed"),
      all_tasks: z.array(taskRefSchema).describe("All tasks in the plan"),
      completed_task_ids: z.array(z.string()).describe("IDs of completed tasks"),
      dispatched_task_ids: z.array(z.string()).describe("IDs of currently dispatched tasks"),
    },
    handler: async ({ failed_task, all_tasks, completed_task_ids, dispatched_task_ids }) => {
      return deriveRestartStrategy(failed_task, all_tasks, completed_task_ids, dispatched_task_ids);
    },
  },

  // Plan Diff
  {
    name: "varp_diff_plan",
    description:
      "Structurally diff two parsed plans. Compares metadata, contracts, and tasks by ID.",
    inputSchema: {
      plan_a_path: z.string().describe("Path to first plan.xml"),
      plan_b_path: z.string().describe("Path to second plan.xml"),
    },
    handler: async ({ plan_a_path, plan_b_path }) => {
      const planA = parsePlanFile(plan_a_path);
      const planB = parsePlanFile(plan_b_path);
      return diffPlans(planA, planB);
    },
  },

  // Scoped Tests
  {
    name: "varp_scoped_tests",
    description:
      "Find test files for a given touches declaration. Returns test file paths and a bun test command scoped to the affected components.",
    inputSchema: {
      manifest_path: manifestPath,
      reads: z.array(z.string()).optional().describe("Components this task reads from"),
      writes: z.array(z.string()).optional().describe("Components this task writes to"),
      include_read_tests: z
        .boolean()
        .optional()
        .describe("Include test files from read components (default false)"),
      tags: z
        .array(z.string())
        .optional()
        .describe("Only include components whose tags intersect with this filter"),
    },
    handler: async ({ manifest_path, reads, writes, include_read_tests, tags }) => {
      const mp = manifest_path ?? "./varp.yaml";
      const manifest = parseManifest(mp);
      const manifestDir = dirname(resolve(mp));
      return findScopedTests(manifest, { reads, writes }, manifestDir, {
        includeReadTests: include_read_tests ?? false,
        tags,
      });
    },
  },

  // Lint
  {
    name: "varp_lint",
    description:
      "Run all health checks: import deps, link integrity, doc freshness. Returns unified report with issues and severity.",
    inputSchema: { manifest_path: manifestPath },
    handler: async ({ manifest_path }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return runLint(manifest, manifest_path ?? "./varp.yaml");
    },
  },

  // Env Check
  {
    name: "varp_check_env",
    description:
      "Check environment variables required by components. Returns which are set and which are missing.",
    inputSchema: {
      manifest_path: manifestPath,
      components: z.array(z.string()).describe("Component names to check env vars for"),
    },
    handler: async ({ manifest_path, components }) => {
      const manifest = parseManifest(manifest_path ?? "./varp.yaml");
      return checkEnv(manifest, components, process.env);
    },
  },

  // Suggest Components
  {
    name: "varp_suggest_components",
    description:
      "Analyze a layer-organized project to suggest multi-path component groupings. Scans layer directories for files with common name stems across layers.",
    inputSchema: {
      root_dir: z.string().describe("Root directory to scan for layer directories"),
      layer_dirs: z
        .array(z.string())
        .optional()
        .describe(
          "Layer directory names to scan (auto-detected if omitted: controllers, services, repositories, etc.)",
        ),
      suffixes: z
        .array(z.string())
        .optional()
        .describe(
          "File suffixes to strip when extracting name stems (defaults to .controller, .service, .repository, etc.)",
        ),
    },
    handler: async ({ root_dir, layer_dirs, suffixes }) => {
      return suggestComponents(root_dir, {
        layerDirs: layer_dirs,
        suffixes,
      });
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
