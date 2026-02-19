import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { discoverFiles } from "../discovery.js";
import type { FileContent } from "../index.js";
import type { AuditProgressEvent } from "../index.js";
import {
  parseRuleset,
  generatePlan,
  executeAuditPlan,
  printComplianceReport,
  generateComplianceMarkdown,
  generateComplianceJson,
  diffReports,
  printDriftReport,
  generateDriftMarkdown,
  generateDriftJson,
} from "../index.js";
import { getChangedFiles, filterToChanged } from "../planner/diff-filter.js";
import { callClaude } from "./claude-client.js";

// ── Arg helpers (inlined from @varp/cli args.ts) ──

function parseEnum<T extends string>(value: string, valid: readonly T[], name: string): T {
  if (valid.includes(value as T)) return value as T;
  throw new Error(`Invalid ${name}: ${value}. Must be ${valid.join(" or ")}`);
}

function consumeOptionalFlag(
  argv: string[],
  i: number,
  defaultValue: string,
): [value: string, newIndex: number] {
  const next = argv[i + 1];
  if (next && !next.startsWith("-")) {
    return [next, i + 1];
  }
  return [defaultValue, i];
}

// ── Arg parsing ──

export interface AuditArgs {
  path: string;
  ruleset: string;
  model?: string;
  concurrency?: number;
  format?: "text" | "json" | "markdown";
  output?: string;
  quiet?: boolean;
  /** Git ref for incremental audit. When set, only audit changed files. */
  diff?: string;
  /** Max estimated tokens to spend. Low-priority tasks skipped when exceeded. */
  budget?: number;
  /** Path to a baseline compliance report JSON for drift comparison. */
  baseline?: string;
}

export function parseAuditArgs(argv: string[]): AuditArgs {
  // argv: everything after "audit" subcommand
  let path: string | undefined;
  let ruleset = "owasp-top-10";
  let model: string | undefined;
  let concurrency: number | undefined;
  let format: "text" | "json" | "markdown" | undefined;
  let output: string | undefined;
  let quiet = false;
  let diff: string | undefined;
  let budget: number | undefined;
  let baseline: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--baseline" && argv[i + 1]) {
      baseline = argv[++i];
    } else if (arg === "--budget" && argv[i + 1]) {
      budget = parseInt(argv[++i], 10);
      if (isNaN(budget) || budget <= 0) {
        throw new Error(`Invalid budget: must be a positive integer`);
      }
    } else if (arg === "--diff") {
      const [val, newI] = consumeOptionalFlag(argv, i, "HEAD");
      diff = val;
      i = newI;
    } else if (arg === "--ruleset" && argv[i + 1]) {
      ruleset = argv[++i];
    } else if (arg === "--model" && argv[i + 1]) {
      model = argv[++i];
    } else if (arg === "--concurrency" && argv[i + 1]) {
      concurrency = parseInt(argv[++i], 10);
    } else if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i], ["text", "json", "markdown"] as const, "format");
    } else if (arg === "--output" && argv[i + 1]) {
      output = argv[++i];
    } else if (arg === "--quiet") {
      quiet = true;
    } else if (!arg.startsWith("-") && !path) {
      path = arg;
    }
  }

  if (!path) {
    throw new Error(
      "Path argument is required.\nUsage: varp-audit audit <path> [--ruleset <name>] [--format text|json|markdown]",
    );
  }

  return { path, ruleset, model, concurrency, format, output, quiet, diff, budget, baseline };
}

// ── Ruleset resolution ──

function resolveRuleset(name: string): string {
  // 1. Check if it's a direct path
  if (existsSync(name)) {
    return readFileSync(name, "utf-8");
  }

  // 2. Check built-in rulesets
  const builtinDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../rulesets");
  const builtinPath = resolve(builtinDir, `${name}.md`);
  if (existsSync(builtinPath)) {
    return readFileSync(builtinPath, "utf-8");
  }

  // 3. Check relative to cwd
  const cwdPath = resolve(process.cwd(), name);
  if (existsSync(cwdPath)) {
    return readFileSync(cwdPath, "utf-8");
  }

  // 4. Try with .md extension
  const cwdPathMd = resolve(process.cwd(), `${name}.md`);
  if (existsSync(cwdPathMd)) {
    return readFileSync(cwdPathMd, "utf-8");
  }

  throw new Error(
    `Ruleset not found: ${name}\n` +
      `Searched:\n` +
      `  ${name} (direct path)\n` +
      `  ${builtinPath} (built-in)\n` +
      `  ${cwdPath} (relative)\n` +
      `  ${cwdPathMd} (relative with .md)`,
  );
}

// ── Progress reporter ──

function createAuditProgress(quiet: boolean) {
  if (quiet) return undefined;

  let tasksInWave = 0;
  let completedInWave = 0;

  return (event: AuditProgressEvent) => {
    switch (event.type) {
      case "plan-ready":
        console.log(
          `\nAudit plan: ${event.plan.stats.totalTasks} tasks, ~${event.plan.stats.estimatedTokens.toLocaleString()} tokens`,
        );
        break;
      case "wave-start":
        tasksInWave = event.taskCount;
        completedInWave = 0;
        if (event.wave <= 2) {
          console.log(`\nWave ${event.wave}: ${event.taskCount} tasks`);
        }
        break;
      case "task-complete":
        completedInWave++;
        const findings = event.result.findings.length;
        const findingsStr = findings > 0 ? ` (${findings} findings)` : "";
        console.log(
          `  [${completedInWave}/${tasksInWave}] ${event.task.description}${findingsStr}`,
        );
        break;
      case "task-error":
        completedInWave++;
        console.error(
          `  [${completedInWave}/${tasksInWave}] FAILED: ${event.task.description} — ${event.error.message}`,
        );
        break;
      case "task-skipped":
        console.log(`  SKIPPED: ${event.task.description} (${event.reason})`);
        break;
      case "complete":
        console.log();
        break;
    }
  };
}

// ── Main audit flow ──

export async function runAuditCommand(argv: string[]): Promise<void> {
  const args = parseAuditArgs(argv);

  // Validate path (no API key check — Claude Code handles auth)
  const validatedPath = resolve(args.path);
  if (!existsSync(validatedPath)) {
    throw new Error(`Path does not exist: ${validatedPath}`);
  }

  // Resolve and parse ruleset
  if (!args.quiet) {
    console.log(`Ruleset: ${args.ruleset}`);
  }
  const rulesetContent = resolveRuleset(args.ruleset);
  const ruleset = parseRuleset(rulesetContent);
  if (!args.quiet) {
    console.log(
      `  ${ruleset.meta.framework} v${ruleset.meta.version} — ${ruleset.rules.length} rules, ${ruleset.crossCutting.length} cross-cutting patterns`,
    );
  }

  // Discover files
  if (!args.quiet) {
    console.log(`\nDiscovering files in: ${validatedPath}`);
  }
  const discoveredFiles = await discoverFiles(validatedPath);
  if (!args.quiet) {
    console.log(`  Found ${discoveredFiles.length} files`);
  }

  let files: FileContent[] = discoveredFiles;

  // Apply diff filter for incremental audits
  let diffMeta: { ref: string; changedFiles: number } | undefined;
  if (args.diff) {
    const changedPaths = getChangedFiles(validatedPath, args.diff);
    if (!args.quiet) {
      console.log(`\nIncremental audit: ${changedPaths.length} files changed (diff: ${args.diff})`);
    }
    files = filterToChanged(files, changedPaths);
    diffMeta = { ref: args.diff, changedFiles: changedPaths.length };
    if (!args.quiet) {
      console.log(`  Auditing ${files.length} files after filtering`);
    }
  }

  // Generate plan
  const plan = generatePlan(files, ruleset, { targetPath: validatedPath });

  // Execute
  const report = await executeAuditPlan(plan, files, ruleset, {
    caller: callClaude,
    model: args.model || "claude-sonnet-4-5-20250929",
    concurrency: args.concurrency,
    onProgress: createAuditProgress(args.quiet ?? false),
    targetPath: validatedPath,
    diff: diffMeta,
    budget: args.budget,
  });

  // Output
  const fmt = args.format || "text";
  if (fmt === "json") {
    console.log(generateComplianceJson(report));
  } else if (fmt === "markdown") {
    console.log(generateComplianceMarkdown(report));
  } else {
    printComplianceReport(report);
  }

  // Drift comparison
  if (args.baseline) {
    const baselinePath = resolve(args.baseline);
    if (!existsSync(baselinePath)) {
      throw new Error(`Baseline report not found: ${baselinePath}`);
    }
    const baselineReport = JSON.parse(readFileSync(baselinePath, "utf-8"));
    const drift = diffReports(baselineReport, report);

    if (fmt === "json") {
      console.log(generateDriftJson(drift));
    } else if (fmt === "markdown") {
      console.log(generateDriftMarkdown(drift));
    } else {
      console.log(printDriftReport(drift));
    }
  }

  // Save to file
  if (args.output) {
    let content: string;
    if (fmt === "json") {
      content = generateComplianceJson(report);
    } else if (fmt === "markdown") {
      content = generateComplianceMarkdown(report);
    } else {
      content = generateComplianceMarkdown(report); // text saves as markdown
    }
    writeFileSync(args.output, content, "utf-8");
    if (!args.quiet) {
      console.log(`Report saved to: ${args.output}`);
    }
  }

  // Exit with non-zero if critical findings
  if (report.summary.critical > 0) {
    process.exit(1);
  }
}
