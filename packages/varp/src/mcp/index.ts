import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import {
  type LinkScanMode,
  ackFreshness,
  buildCodebaseGraph,
  buildComponentPaths,
  buildCouplingMatrix,
  checkEnv,
  checkFreshness,
  checkWarmStaleness,
  componentCouplingProfile,
  componentPaths,
  computeComplexityTrends,
  computeCriticalPath,
  computeHotspots,
  computeWaves,
  countLines,
  deriveRestartStrategy,
  detectHazards,
  diffPlans,
  fileNeighborhood,
  findHiddenCoupling,
  findOwningComponent,
  findScopedTests,
  invalidationCascade,
  parseLogFile,
  parseManifest,
  parsePlanFile,
  renderAsciiGraph,
  renderGraph,
  renderTagGroups,
  resolveComponentRefs,
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
  TaskDefinitionSchema,
} from "../lib.js";
import { registerTools, type ToolDef } from "./tool-registry.js";

// ── Shared Schemas ──

const DEFAULT_MANIFEST_PATH = "./varp.yaml";

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const manifestPath = z.string().optional().describe("Path to varp.yaml (defaults to ./varp.yaml)");

const schedulerTasksInput = {
  tasks: z.array(TaskDefinitionSchema).describe("Tasks with touches declarations"),
};

// ── Tool Definitions ──

const tools: ToolDef[] = [
  // Health
  {
    name: "varp_health",
    description:
      "Project health check: parse manifest, check doc freshness, and run lint. Use mode='all' (default) for complete health report. Ideal session-start tool.",
    annotations: READ_ONLY,
    inputSchema: {
      manifest_path: manifestPath,
      mode: z
        .enum(["manifest", "freshness", "lint", "all"])
        .optional()
        .default("all")
        .describe("Check mode: manifest, freshness, lint, or all (default)"),
    },
    handler: async ({ manifest_path, mode }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifest = parseManifest(mp);
      const m = mode ?? "all";

      if (m === "manifest") {
        const graphResult = validateDependencyGraph(manifest);
        return {
          manifest: {
            manifest,
            dependency_graph_valid: graphResult.valid,
            ...(graphResult.valid ? {} : { cycles: graphResult.cycles }),
          },
        };
      }
      if (m === "freshness") {
        return { freshness: checkFreshness(manifest, dirname(resolve(mp))) };
      }
      if (m === "lint") {
        return { lint: await runLint(manifest, mp) };
      }
      // all
      const graphResult = validateDependencyGraph(manifest);
      return {
        manifest: {
          manifest,
          dependency_graph_valid: graphResult.valid,
          ...(graphResult.valid ? {} : { cycles: graphResult.cycles }),
        },
        freshness: checkFreshness(manifest, dirname(resolve(mp))),
        lint: await runLint(manifest, mp),
      };
    },
  },

  // Manifest
  {
    name: "varp_resolve_docs",
    description:
      "Given a task's touches declaration, returns doc paths to load. Auto-discovers README.md (public) and docs/*.md (private) within component paths. Reads load public docs only. Writes load all docs.",
    annotations: READ_ONLY,
    inputSchema: {
      manifest_path: manifestPath,
      reads: z.array(z.string()).optional().describe("Components or tags this task reads from"),
      writes: z.array(z.string()).optional().describe("Components or tags this task writes to"),
    },
    handler: async ({ manifest_path, reads, writes }) => {
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return resolveDocs(manifest, {
        reads: reads ? resolveComponentRefs(manifest, reads) : undefined,
        writes: writes ? resolveComponentRefs(manifest, writes) : undefined,
      });
    },
  },
  {
    name: "varp_invalidation_cascade",
    description:
      "Given changed components, walks deps to return all transitively affected components.",
    annotations: READ_ONLY,
    outputSchema: {
      affected: z.array(z.string()).describe("All transitively affected component names"),
    },
    inputSchema: {
      manifest_path: manifestPath,
      changed: z.array(z.string()).describe("Component names or tags whose interface docs changed"),
    },
    handler: async ({ manifest_path, changed }) => {
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return { affected: invalidationCascade(manifest, resolveComponentRefs(manifest, changed)) };
    },
  },
  {
    name: "varp_ack_freshness",
    description:
      "Acknowledge component docs as reviewed and still accurate. Records current timestamp so docs are no longer flagged stale until source changes again.",
    annotations: WRITE,
    outputSchema: {
      acked: z.array(z.string()).describe("Component names whose docs were acknowledged"),
    },
    inputSchema: {
      manifest_path: manifestPath,
      components: z.array(z.string()).describe("Component names or tags whose docs to acknowledge"),
      doc: z
        .string()
        .optional()
        .describe("Specific doc key to ack (e.g. 'README'). Omit to ack all docs."),
    },
    handler: async ({ manifest_path, components, doc }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifest = parseManifest(mp);
      return ackFreshness(
        manifest,
        dirname(resolve(mp)),
        resolveComponentRefs(manifest, components),
        doc,
      );
    },
  },

  // Plan
  {
    name: "varp_parse_plan",
    description: "Parse plan.xml and return typed plan with metadata, contracts, and task graph.",
    annotations: READ_ONLY,
    inputSchema: { path: z.string().describe("Path to plan.xml") },
    handler: async ({ path }) => parsePlanFile(path),
  },
  {
    name: "varp_validate_plan",
    description:
      "Check plan consistency against manifest: touches reference known components, unique task IDs.",
    annotations: READ_ONLY,
    inputSchema: {
      plan_path: z.string().describe("Path to plan.xml"),
      manifest_path: manifestPath,
    },
    handler: async ({ plan_path, manifest_path }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const plan = parsePlanFile(plan_path);
      const manifest = parseManifest(mp);
      const taskDefs = plan.tasks.map(({ id, touches, mutexes }) => ({ id, touches, mutexes }));
      const hazards = detectHazards(taskDefs);
      const { import_deps } = scanImports(manifest, dirname(resolve(mp)));
      return validatePlan(plan, manifest, hazards, import_deps);
    },
  },

  // Scheduler
  {
    name: "varp_schedule",
    description:
      "Analyze task scheduling: compute execution waves, detect data hazards (RAW/WAR/WAW/MUTEX), and find the critical path. Use mode='all' (default) for complete analysis.",
    annotations: READ_ONLY,
    inputSchema: {
      ...schedulerTasksInput,
      mode: z
        .enum(["waves", "hazards", "critical_path", "all"])
        .optional()
        .default("all")
        .describe("Analysis mode: waves, hazards, critical_path, or all (default)"),
    },
    handler: async ({ tasks, mode }) => {
      const m = mode ?? "all";
      if (m === "waves") return { waves: computeWaves(tasks) };
      if (m === "hazards") return { hazards: detectHazards(tasks) };
      if (m === "critical_path") return { critical_path: computeCriticalPath(tasks) };
      // all
      const hazards = detectHazards(tasks);
      return {
        waves: computeWaves(tasks),
        hazards,
        critical_path: computeCriticalPath(tasks, hazards),
      };
    },
  },

  // Link Scanner
  {
    name: "varp_scan_links",
    description:
      "Scan component docs for markdown links. Infer cross-component dependencies, detect broken links, and compare against declared deps.",
    annotations: READ_ONLY,
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
    annotations: READ_ONLY,
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
    annotations: READ_ONLY,
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

  // List Files
  {
    name: "varp_list_files",
    description:
      "List source files for given components or tags. Returns file paths grouped by component. Complements varp_suggest_touches (files→components) with the reverse lookup (components→files).",
    annotations: READ_ONLY,
    outputSchema: {
      files: z
        .array(
          z.object({
            component: z.string().describe("Component name"),
            paths: z.array(z.string()).describe("Absolute file paths"),
          }),
        )
        .describe("Files grouped by component"),
      total: z.number().describe("Total file count across all components"),
    },
    inputSchema: {
      manifest_path: manifestPath,
      components: z.array(z.string()).describe("Component names or tags to list files for"),
    },
    handler: async ({ manifest_path, components: rawComponents }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifest = parseManifest(mp);
      const components = resolveComponentRefs(manifest, rawComponents);
      const files: Array<{ component: string; paths: string[] }> = [];
      let total = 0;
      for (const name of components) {
        const comp = manifest.components[name];
        if (!comp) continue;
        const compFiles: string[] = [];
        for (const compPath of componentPaths(comp)) {
          try {
            const entries = readdirSync(compPath, { withFileTypes: true, recursive: true });
            for (const entry of entries) {
              if (!entry.isFile()) continue;
              compFiles.push(resolve(entry.parentPath ?? compPath, entry.name));
            }
          } catch {
            // Component path doesn't exist — skip
          }
        }
        files.push({ component: name, paths: compFiles });
        total += compFiles.length;
      }
      return { files, total };
    },
  },

  // Enforcement
  {
    name: "varp_verify_capabilities",
    description:
      "Check that file modifications fall within the declared touches write set. Returns violations for out-of-scope writes.",
    annotations: READ_ONLY,
    outputSchema: {
      valid: z.boolean().describe("True if all modifications are within declared write scope"),
      violations: z
        .array(
          z.object({
            path: z.string().describe("File path that was modified out of scope"),
            declared_component: z
              .string()
              .nullable()
              .describe("Component the file was expected to be in, or null"),
            actual_component: z.string().describe("Component the file actually belongs to"),
          }),
        )
        .describe("Out-of-scope modifications"),
    },
    inputSchema: {
      manifest_path: manifestPath,
      reads: z.array(z.string()).optional().describe("Components or tags declared as reads"),
      writes: z.array(z.string()).optional().describe("Components or tags declared as writes"),
      diff_paths: z.array(z.string()).describe("File paths that were modified"),
    },
    handler: async ({ manifest_path, reads, writes, diff_paths }) => {
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return verifyCapabilities(
        manifest,
        {
          reads: reads ? resolveComponentRefs(manifest, reads) : undefined,
          writes: writes ? resolveComponentRefs(manifest, writes) : undefined,
        },
        diff_paths,
      );
    },
  },
  {
    name: "varp_derive_restart_strategy",
    description:
      "Given a failed task and execution state, derive restart strategy: isolated_retry, cascade_restart, or escalate.",
    annotations: READ_ONLY,
    inputSchema: {
      failed_task: TaskDefinitionSchema.describe("The task that failed"),
      all_tasks: z.array(TaskDefinitionSchema).describe("All tasks in the plan"),
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
    annotations: READ_ONLY,
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
    annotations: READ_ONLY,
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

  // Env Check
  {
    name: "varp_check_env",
    description:
      "Check environment variables required by components. Returns which are set and which are missing.",
    annotations: READ_ONLY,
    outputSchema: {
      required: z.array(z.string()).describe("All required environment variable names"),
      set: z.array(z.string()).describe("Required env vars that are currently set"),
      missing: z.array(z.string()).describe("Required env vars that are missing"),
    },
    inputSchema: {
      manifest_path: manifestPath,
      components: z.array(z.string()).describe("Component names or tags to check env vars for"),
    },
    handler: async ({ manifest_path, components }) => {
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return checkEnv(manifest, resolveComponentRefs(manifest, components), process.env);
    },
  },

  // Suggest Components
  {
    name: "varp_suggest_components",
    description:
      "Analyze a project to suggest component groupings. Auto mode (default) runs five strategies in priority order: workspace packages, container dirs (packages/, apps/), indicator dirs (src/, app/, node_modules/), layer cross-matching, and domain detection. Conventions inspectable via DEFAULT_DETECTION_CONFIG.",
    annotations: READ_ONLY,
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
    annotations: READ_ONLY,
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
    annotations: READ_ONLY,
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

  // Coupling Analysis
  {
    name: "varp_coupling",
    description:
      "Analyze coupling: co-change matrix, hidden coupling hotspots, per-file neighborhood (what else changes when I touch this file?), or file-level churn hotspots. Use mode='neighborhood' with file param for per-file query, mode='file_hotspots' for churn scoring, mode='all' for full component-level analysis.",
    annotations: READ_ONLY,
    inputSchema: {
      manifest_path: manifestPath,
      mode: z
        .enum(["co_changes", "matrix", "hotspots", "neighborhood", "file_hotspots", "all"])
        .optional()
        .default("all")
        .describe(
          "Analysis mode: co_changes, matrix, hotspots (component-level hidden coupling), neighborhood (per-file co-change neighbors), file_hotspots (churn × LOC scoring), or all (default)",
        ),
      file: z
        .string()
        .optional()
        .describe("File path for neighborhood query (required when mode=neighborhood)"),
      component: z
        .string()
        .optional()
        .describe("Filter matrix/hotspots/file_hotspots to pairs involving this component"),
      structural_threshold: z
        .number()
        .optional()
        .describe("Manual structural threshold for matrix (default: auto-calibrated)"),
      behavioral_threshold: z
        .number()
        .optional()
        .describe("Manual behavioral threshold for matrix (default: auto-calibrated)"),
      limit: z.number().optional().describe("Max hotspot entries to return (default 20)"),
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
        .describe("Glob patterns for files to exclude from co-change analysis"),
    },
    handler: async ({
      manifest_path,
      mode,
      file,
      component,
      structural_threshold,
      behavioral_threshold,
      limit,
      max_commit_files,
      skip_message_patterns,
      exclude_paths,
    }) => {
      const mp = manifest_path ?? DEFAULT_MANIFEST_PATH;
      const manifestDir = dirname(resolve(mp));
      const m = mode ?? "all";

      if (m === "co_changes") {
        const config = {
          ...(max_commit_files !== undefined && { max_commit_files }),
          ...(skip_message_patterns !== undefined && { skip_message_patterns }),
          ...(exclude_paths !== undefined && { exclude_paths }),
        };
        return { co_changes: scanCoChangesWithCache(manifestDir, config) };
      }

      if (m === "neighborhood") {
        if (!file) throw new Error("file parameter is required for mode=neighborhood");
        const manifest = parseManifest(mp);
        const coChange = scanCoChangesWithCache(manifestDir);
        const imports = scanImports(manifest, manifestDir);
        const neighbors = fileNeighborhood(file, coChange.edges, imports);
        const neighborFiles = neighbors.map((n) => n.file);
        const allFiles = [file, ...neighborFiles];
        const trends = computeComplexityTrends(manifestDir, allFiles);
        const compPaths = buildComponentPaths(manifest);
        const absFile = resolve(manifestDir, file);
        const owningComponent = findOwningComponent(absFile, manifest, compPaths);
        return {
          file,
          component: owningComponent,
          neighbors: neighbors.slice(0, limit ?? 20),
          trends,
          total_neighbors: neighbors.length,
        };
      }

      if (m === "file_hotspots") {
        const coChange = scanCoChangesWithCache(manifestDir);
        const frequencies = coChange.file_frequencies ?? {};
        const filePaths = Object.keys(frequencies);
        const lineCounts = countLines(filePaths, manifestDir);
        let hotspots = computeHotspots(frequencies, lineCounts);
        if (component) {
          const manifest = parseManifest(mp);
          const compPaths = buildComponentPaths(manifest);
          hotspots = hotspots.filter((h) => {
            const abs = resolve(manifestDir, h.file);
            return findOwningComponent(abs, manifest, compPaths) === component;
          });
        }
        const limited = hotspots.slice(0, limit ?? 20);
        const trendFiles = limited.map((h) => h.file);
        const trends = computeComplexityTrends(manifestDir, trendFiles);
        for (const entry of limited) {
          entry.trend = trends[entry.file];
        }
        return { hotspots: limited, total: hotspots.length };
      }

      const manifest = parseManifest(mp);
      const coChange = scanCoChangesWithCache(manifestDir);
      const imports = scanImports(manifest, manifestDir);
      const matrix = buildCouplingMatrix(coChange, imports, manifest, {
        repo_dir: manifestDir,
        structural_threshold,
        behavioral_threshold,
      });

      if (m === "matrix") {
        if (component) {
          return { matrix: { ...matrix, entries: componentCouplingProfile(matrix, component) } };
        }
        return { matrix };
      }

      if (m === "hotspots") {
        const hotspots = findHiddenCoupling(matrix);
        return { hotspots: hotspots.slice(0, limit ?? 20), total: hotspots.length };
      }

      // all
      const hotspots = findHiddenCoupling(matrix);
      const matrixResult = component
        ? { ...matrix, entries: componentCouplingProfile(matrix, component) }
        : matrix;
      return {
        co_changes: coChange,
        matrix: matrixResult,
        hotspots: hotspots.slice(0, limit ?? 20),
        total_hotspots: hotspots.length,
      };
    },
  },

  // Codebase Graph
  {
    name: "varp_build_codebase_graph",
    description:
      "Build a complete CodebaseGraph combining manifest, co-change analysis, import scanning, and optional coupling matrix. Returns the unified analysis layer output.",
    annotations: READ_ONLY,
    inputSchema: {
      manifest_path: manifestPath,
      with_coupling: z
        .boolean()
        .optional()
        .default(false)
        .describe("Include coupling matrix in the graph"),
    },
    handler: async ({ manifest_path, with_coupling }) => {
      return buildCodebaseGraph(manifest_path ?? DEFAULT_MANIFEST_PATH, {
        withCoupling: with_coupling,
      });
    },
  },

  // Watch Freshness
  {
    name: "varp_watch_freshness",
    description:
      "Check freshness and return changes since a given baseline timestamp. Returns only components/docs modified since the baseline. Omit since for initial snapshot.",
    annotations: READ_ONLY,
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
    annotations: READ_ONLY,
    inputSchema: {
      manifest_path: manifestPath,
      components: z
        .array(z.string())
        .describe("Components or tags the warm agent has context about"),
      since: z.string().describe("ISO timestamp when the agent was last active"),
    },
    handler: async ({ manifest_path, components, since }) => {
      const manifest = parseManifest(manifest_path ?? DEFAULT_MANIFEST_PATH);
      return checkWarmStaleness(
        manifest,
        resolveComponentRefs(manifest, components),
        new Date(since),
      );
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
