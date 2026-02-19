import { dirname, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  type LinkScanMode,
  ackFreshness,
  buildCouplingMatrix,
  checkEnv,
  checkFreshness,
  checkWarmStaleness,
  componentCouplingProfile,
  computeCriticalPath,
  computeWaves,
  deriveRestartStrategy,
  detectHazards,
  diffPlans,
  findHiddenCoupling,
  findScopedTests,
  invalidationCascade,
  parseLogFile,
  parseManifest,
  parsePlanFile,
  renderAsciiGraph,
  renderGraph,
  renderTagGroups,
  resolveDocs,
  runLint,
  scanCoChangesWithCache,
  scanImports,
  scanLinks,
  suggestComponents,
  suggestTouches,
  validateDependencyGraph,
  validatePlan,
  verifyCapabilities,
  watchFreshness,
  TouchesSchema,
} from "@varp/core/lib";
import { z } from "zod";

import { registerTools, type ToolDef } from "./tool-registry.js";

// ── Shared Schemas ──

const DEFAULT_MANIFEST_PATH = "./varp.yaml";

const manifestPath = z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)");

const mutexesSchema = z.array(z.string()).optional().describe("Named mutexes for mutual exclusion");

const taskRefSchema = z.object({ id: z.string(), touches: TouchesSchema, mutexes: mutexesSchema });

const schedulableTaskSchema = z.object({
  id: z.string(),
  touches: TouchesSchema,
  mutexes: mutexesSchema,
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
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
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
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
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
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return { affected: invalidationCascade(manifest, changed) };
    },
  },
  {
    name: "varp_check_freshness",
    description:
      "Returns freshness status for all component docs — last modified timestamps, staleness relative to source.",
    inputSchema: { manifest_path: manifestPath },
    handler: async ({ manifest_path }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifest = parseManifest(mp);
      return checkFreshness(manifest, dirname(resolve(mp)));
    },
  },
  {
    name: "varp_ack_freshness",
    description:
      "Acknowledge component docs as reviewed and still accurate. Records current timestamp so docs are no longer flagged stale until source changes again.",
    inputSchema: {
      manifest_path: manifestPath,
      components: z.array(z.string()).describe("Component names whose docs to acknowledge"),
      doc: z
        .string()
        .optional()
        .describe("Specific doc key to ack (e.g. 'README'). Omit to ack all docs."),
    },
    handler: async ({ manifest_path, components, doc }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifest = parseManifest(mp);
      return ackFreshness(manifest, dirname(resolve(mp)), components, doc);
    },
  },

  // Plan
  {
    name: "varp_parse_plan",
    description: "Parse plan.xml and return typed plan with metadata, contracts, and task graph.",
    inputSchema: { path: z.string().describe("Path to plan.xml") },
    handler: async ({ path }) => parsePlanFile(path),
  },
  {
    name: "varp_validate_plan",
    description:
      "Check plan consistency against manifest: touches reference known components, unique task IDs.",
    inputSchema: {
      plan_path: z.string().describe("Path to plan.xml"),
      manifest_path: manifestPath,
    },
    handler: async ({ plan_path, manifest_path }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
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
    description: "Return all data hazards (RAW/WAR/WAW) and mutex conflicts (MUTEX) between tasks.",
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
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
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
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
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
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
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
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
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
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
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
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return runLint(manifest, manifest_path ?? DEFAULT_MANIFEST_PATH);
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
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return checkEnv(manifest, components, process.env);
    },
  },

  // Suggest Components
  {
    name: "varp_suggest_components",
    description:
      "Analyze a project to suggest multi-path component groupings. Supports layer-organized (controllers/, services/), domain-organized (auth/controllers/, auth/services/), or auto (both) detection modes.",
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
      mode: z
        .enum(["layers", "domains", "auto"])
        .optional()
        .describe(
          "Detection mode: layers (files across layer dirs), domains (domain dirs with layer subdirs), auto (both, default)",
        ),
    },
    handler: async ({ root_dir, layer_dirs, suffixes, mode }) => {
      return suggestComponents(root_dir, {
        layerDirs: layer_dirs,
        suffixes,
        mode,
      });
    },
  },

  // Parse Log
  {
    name: "varp_parse_log",
    description:
      "Parse execution log.xml (written by /varp:execute skill) into typed structure with task metrics, postcondition checks, and wave status.",
    inputSchema: {
      path: z.string().describe("Path to log.xml"),
    },
    handler: async ({ path }) => parseLogFile(path),
  },

  // Render Graph
  {
    name: "varp_render_graph",
    description:
      "Render the manifest dependency graph as Mermaid diagram syntax, ASCII text, or tag groups. Annotates nodes with stability badges.",
    inputSchema: {
      manifest_path: manifestPath,
      direction: z
        .enum(["TD", "LR"])
        .optional()
        .describe("Graph direction: TD (top-down, default) or LR (left-right)"),
      format: z
        .enum(["mermaid", "ascii"])
        .optional()
        .describe('Output format: "mermaid" (default) or "ascii" for terminal display'),
      tags: z
        .enum(["color", "superscript", "group", "false"])
        .optional()
        .describe(
          'Tag display: "color" (default, colored dots), "superscript" (numbered), "group" (group-by-tag view), "false" (hide)',
        ),
      stability: z.boolean().optional().describe("Show stability badges (default: true)"),
    },
    handler: async ({ manifest_path, direction, format, tags, stability }) => {
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);

      if (tags === "group") {
        return { tag_groups: renderTagGroups(manifest) };
      }

      if (format === "ascii") {
        const tagMode = tags === "false" ? false : (tags ?? "superscript");
        return {
          ascii: renderAsciiGraph(manifest, {
            tags: tagMode as "color" | "superscript" | false,
            stability,
          }),
        };
      }

      return { mermaid: renderGraph(manifest, { direction }) };
    },
  },

  // Co-Change Analysis
  {
    name: "varp_scan_co_changes",
    description:
      "Scan git history for file co-change patterns. Returns weighted co-change graph with file pairs that frequently change together.",
    inputSchema: {
      manifest_path: manifestPath,
      max_commit_files: z
        .number()
        .optional()
        .describe("Skip commits touching more than this many files (default 50)"),
      skip_message_patterns: z
        .array(z.string())
        .optional()
        .describe("Skip commits whose subject matches these patterns"),
      exclude_paths: z
        .array(z.string())
        .optional()
        .describe("Glob patterns for files to exclude from analysis"),
    },
    handler: async ({ manifest_path, max_commit_files, skip_message_patterns, exclude_paths }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const repoDir = dirname(resolve(mp));
      const config = {
        ...(max_commit_files !== undefined && { max_commit_files }),
        ...(skip_message_patterns !== undefined && { skip_message_patterns }),
        ...(exclude_paths !== undefined && { exclude_paths }),
      };
      return scanCoChangesWithCache(repoDir, config);
    },
  },
  {
    name: "varp_coupling_matrix",
    description:
      "Build coupling matrix combining git co-change (behavioral) and import analysis (structural) signals. Classifies component pairs into quadrants: explicit_module, stable_interface, hidden_coupling, unrelated.",
    inputSchema: {
      manifest_path: manifestPath,
      structural_threshold: z
        .number()
        .optional()
        .describe("Manual structural threshold (default: auto-calibrated median)"),
      behavioral_threshold: z
        .number()
        .optional()
        .describe("Manual behavioral threshold (default: auto-calibrated median)"),
      component: z.string().optional().describe("Filter results to pairs involving this component"),
    },
    handler: async ({ manifest_path, structural_threshold, behavioral_threshold, component }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifestDir = dirname(resolve(mp));
      const manifest = parseManifest(mp);
      const coChange = scanCoChangesWithCache(manifestDir);
      const imports = scanImports(manifest, manifestDir);
      const matrix = buildCouplingMatrix(coChange, imports, manifest, {
        repo_dir: manifestDir,
        structural_threshold,
        behavioral_threshold,
      });
      if (component) {
        return { ...matrix, entries: componentCouplingProfile(matrix, component) };
      }
      return matrix;
    },
  },
  {
    name: "varp_coupling_hotspots",
    description:
      "Find hidden coupling hotspots — component pairs that frequently co-change but have no import relationship. Sorted by behavioral weight descending.",
    inputSchema: {
      manifest_path: manifestPath,
      limit: z.number().optional().describe("Maximum entries to return (default 20)"),
    },
    handler: async ({ manifest_path, limit }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifestDir = dirname(resolve(mp));
      const manifest = parseManifest(mp);
      const coChange = scanCoChangesWithCache(manifestDir);
      const imports = scanImports(manifest, manifestDir);
      const matrix = buildCouplingMatrix(coChange, imports, manifest, {
        repo_dir: manifestDir,
      });
      const hotspots = findHiddenCoupling(matrix);
      return { hotspots: hotspots.slice(0, limit ?? 20), total: hotspots.length };
    },
  },

  // Watch Freshness
  {
    name: "varp_watch_freshness",
    description:
      "Check freshness and return changes since a given baseline timestamp. Returns only components/docs modified since the baseline. Omit since for initial snapshot.",
    inputSchema: {
      manifest_path: manifestPath,
      since: z
        .string()
        .optional()
        .describe(
          "ISO timestamp baseline — only return changes after this time. Omit for full snapshot.",
        ),
    },
    handler: async ({ manifest_path, since }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifest = parseManifest(mp);
      return watchFreshness(manifest, since, dirname(resolve(mp)));
    },
  },

  // Warm Staleness
  {
    name: "varp_check_warm_staleness",
    description:
      "Check whether components have been modified since a warm agent was last active. Returns whether it is safe to resume the agent or if components are stale.",
    inputSchema: {
      manifest_path: manifestPath,
      components: z.array(z.string()).describe("Components the warm agent has context about"),
      since: z.string().describe("ISO timestamp when the agent was last active"),
    },
    handler: async ({ manifest_path, components, since }) => {
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return checkWarmStaleness(manifest, components, new Date(since));
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
