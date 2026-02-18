#!/usr/bin/env bun

import { parseArgs } from "util";
import { writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig, validateConfig, type Config, type OutputFormat, type VerbosityLevel } from "./config";
import {
  createChunks,
  formatChunkSummary,
  runAudit,
  synthesizeReport,
  printReport,
  generateMarkdown,
} from "@code-auditor/core";
import { discoverFiles } from "@code-auditor/core/src/discovery";
import { formatJson } from "./formatters/json";
import { formatMarkdown } from "./formatters/markdown";
import { formatHtml } from "./formatters/html";
import { syncToDashboard } from "./dashboard-sync";
import { login, logout } from "./auth";
import { createProgressReporter } from "./progress";
import { formatError } from "./errors";
import { validateInput, ValidationError } from "./validation";
import { watchMode } from "./watch";
import { generateCompletions } from "./completions";

// Get version from package.json
function getVersion(): string {
  try {
    // In compiled binary, use compile-time constant
    if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
      const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), "../package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return pkg.version;
    }
    return "0.1.0"; // Fallback
  } catch {
    return "0.1.0"; // Fallback
  }
}

const HELP_TEXT = `
AI Code Audit - Multi-agent code quality analysis tool

USAGE:
  code-audit <path> [options]
  code-audit login
  code-audit logout
  bun run src/cli.ts <path> [options]

COMMANDS:
  login               Save API key for dashboard syncing
  logout              Remove saved API key
  completions [bash|zsh]  Generate shell completion script

ARGUMENTS:
  <path>              Path to file or directory to audit

OPTIONS:
  --output <path>     Write report to file (default: stdout)
  --format <type>     Output format: text, json, markdown, html (default: text)
  --model <name>      Claude model to use (default: claude-sonnet-4-5-20250929)
  --max-tokens <n>    Maximum tokens per chunk (default: 100000)
  --no-parallel       Disable parallel processing
  --watch             Watch mode - re-run on file changes
  --quiet             Minimal output (only score + critical findings)
  --verbose           Detailed output with all findings
  --debug             Debug output with API calls and timing
  --version, -v       Show version number
  --help, -h          Show this help message

ENVIRONMENT:
  ANTHROPIC_API_KEY       Required. Your Anthropic API key
  CODE_AUDITOR_API_KEY    Optional. Dashboard API key (or use 'login' command)
  CODE_AUDITOR_API_URL    Optional. Dashboard URL (default: https://code-auditor.com)

CONFIGURATION:
  Create a .code-audit.json file in your project directory:
  {
    "model": "claude-sonnet-4-5-20250929",
    "maxTokensPerChunk": 100000,
    "parallel": true
  }

EXAMPLES:
  # Login to dashboard
  code-audit login

  # Audit a single file
  code-audit src/main.ts

  # Audit entire directory
  code-audit src/

  # Save report to file
  code-audit src/ --output report.md

  # JSON output for CI/CD
  code-audit src/ --format json > results.json

  # Watch mode
  code-audit --watch src/

  # Use different model
  code-audit src/ --model claude-opus-4-6
`;

interface CliArgs {
  path?: string;
  output?: string;
  format?: OutputFormat;
  model?: string;
  maxTokens?: number;
  parallel?: boolean;
  watch?: boolean;
  verbosity?: VerbosityLevel;
  version?: boolean;
  help?: boolean;
}

/**
 * Parse command line arguments using Node's util.parseArgs
 */
function parseCliArgs(): CliArgs {
  try {
    const { values, positionals } = parseArgs({
      options: {
        output: { type: "string" },
        format: { type: "string" },
        model: { type: "string" },
        "max-tokens": { type: "string" },
        "no-parallel": { type: "boolean" },
        watch: { type: "boolean" },
        quiet: { type: "boolean" },
        verbose: { type: "boolean" },
        debug: { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    // Determine verbosity level
    let verbosity: VerbosityLevel = "normal";
    if (values.quiet) verbosity = "quiet";
    if (values.verbose) verbosity = "verbose";
    if (values.debug) verbosity = "debug";

    // Validate format
    const format = values.format as string | undefined;
    if (format && !["text", "json", "markdown", "html"].includes(format)) {
      throw new Error(`Invalid format: ${format}. Must be one of: text, json, markdown, html`);
    }

    return {
      path: positionals[0],
      output: values.output as string | undefined,
      format: format as OutputFormat | undefined,
      model: values.model as string | undefined,
      maxTokens: values["max-tokens"] ? parseInt(values["max-tokens"] as string, 10) : undefined,
      parallel: values["no-parallel"] ? false : undefined,
      watch: values.watch as boolean | undefined,
      verbosity,
      version: values.version as boolean | undefined,
      help: values.help as boolean | undefined,
    };
  } catch (error) {
    console.error("Error parsing arguments:", error instanceof Error ? error.message : String(error));
    console.log(HELP_TEXT);
    process.exit(1);
  }
}

/**
 * Core audit logic extracted to support watch mode
 */
async function runAuditFlow(validatedPath: string, config: Config, args: CliArgs): Promise<void> {
  // Discovery phase (use validated path)
  if (config.verbosity !== "quiet") {
    console.log(`Discovering files in: ${validatedPath}`);
  }
  const files = await discoverFiles(validatedPath);
  if (config.verbosity !== "quiet") {
    console.log(`  Found ${files.length} file${files.length === 1 ? "" : "s"}`);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`  Total size: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log();
  }

  // Chunking phase
  if (config.verbosity !== "quiet") {
    console.log("Creating chunks...");
  }
  const chunks = createChunks(files, config.maxTokensPerChunk);
  if (config.verbosity !== "quiet") {
    console.log(formatChunkSummary(chunks));
    console.log();
  }

  // Run multi-agent audit with progress reporting
  const startTime = Date.now();
  const reporter = config.verbosity !== "quiet" ? createProgressReporter() : null;
  const agentResults = await runAudit(
    files,
    { model: config.model, maxTokens: 4096 },
    reporter?.onProgress,
  );
  const durationMs = Date.now() - startTime;

  // Synthesize report
  const report = synthesizeReport(args.path!, agentResults);

  // Output based on format
  if (config.format === "json") {
    console.log(formatJson(report));
  } else if (config.format === "markdown") {
    console.log(formatMarkdown(report));
  } else if (config.format === "html") {
    console.log(formatHtml(report));
  } else {
    // text format (default)
    if (config.verbosity === "quiet") {
      // Minimal output
      console.log(`\nScore: ${report.overallScore.toFixed(1)}/10`);
      if (report.criticalCount > 0) {
        console.log(`${report.criticalCount} critical issue${report.criticalCount === 1 ? "" : "s"}`);
      }
    } else {
      printReport(report);
    }
  }

  // Debug info
  if (config.verbosity === "debug") {
    console.log(`\n[DEBUG] Total duration: ${(durationMs / 1000).toFixed(2)}s`);
    console.log(`[DEBUG] Files analyzed: ${files.length}`);
    console.log(`[DEBUG] Average per agent: ${(durationMs / agentResults.length / 1000).toFixed(2)}s`);
  }

  // Save to file if requested
  if (config.outputPath) {
    let content: string;
    if (config.format === "json") {
      content = formatJson(report);
    } else if (config.format === "markdown") {
      content = formatMarkdown(report);
    } else if (config.format === "html") {
      content = formatHtml(report);
    } else {
      content = generateMarkdown(report);
    }
    writeFileSync(config.outputPath, content, "utf-8");
    if (config.verbosity !== "quiet") {
      console.log(`\n✓ Report saved to: ${config.outputPath}\n`);
    }
  }

  // Sync to dashboard if API key is configured (skip in watch mode to avoid spam)
  if (config.verbosity !== "quiet" && !config.watch) {
    const dashboardResult = await syncToDashboard(report, durationMs);
    if (dashboardResult) {
      console.log(`\n📊 View in dashboard: ${dashboardResult.dashboardUrl}\n`);
    }
  }
}

/**
 * Main orchestration flow
 */
async function main(): Promise<void> {
  // Check for subcommands first (before parsing args)
  const firstArg = process.argv[2];

  if (firstArg === "login") {
    await login();
    return;
  }

  if (firstArg === "logout") {
    logout();
    return;
  }

  if (firstArg === "completions") {
    const shell = (process.argv[3] || "bash") as "bash" | "zsh";
    if (shell !== "bash" && shell !== "zsh") {
      console.error("Error: Shell must be 'bash' or 'zsh'");
      process.exit(1);
    }
    console.log(generateCompletions(shell));
    return;
  }

  // Parse CLI arguments
  const args = parseCliArgs();

  // Show version
  if (args.version) {
    console.log(`AI Code Audit v${getVersion()}`);
    process.exit(0);
  }

  // Show help
  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  // Validate required arguments
  if (!args.path) {
    console.error("Error: Path argument is required\n");
    console.log(HELP_TEXT);
    process.exit(1);
  }

  try {
    // Validate input path and API key first
    const validatedPath = validateInput(args.path);

    // Load and validate configuration
    if (args.verbosity !== "quiet") {
      console.log("Loading configuration...");
    }
    const config = loadConfig({
      outputPath: args.output,
      format: args.format,
      model: args.model,
      maxTokensPerChunk: args.maxTokens,
      parallel: args.parallel,
      watch: args.watch,
      verbosity: args.verbosity,
    });
    validateConfig(config);

    if (config.verbosity !== "quiet") {
      console.log(`  Model: ${config.model}`);
      console.log(`  Max tokens per chunk: ${config.maxTokensPerChunk.toLocaleString()}`);
      console.log(`  Parallel processing: ${config.parallel ? "enabled" : "disabled"}`);
      console.log(`  Output format: ${config.format}`);
      if (config.outputPath) {
        console.log(`  Output: ${config.outputPath}`);
      }
      console.log();
    }

    // Watch mode or single run
    if (config.watch) {
      await watchMode(validatedPath, async () => {
        await runAuditFlow(validatedPath, config, args);
      });
    } else {
      await runAuditFlow(validatedPath, config, args);
    }
  } catch (error) {
    console.error(formatError(error instanceof Error ? error : new Error(String(error))));
    process.exit(1);
  }
}

// Run CLI
main();
