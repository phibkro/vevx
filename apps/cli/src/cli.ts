#!/usr/bin/env bun

import { parseArgs } from "util";
import { writeFileSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { loadConfig, validateConfig, type Config } from "./config";
import { discoverFiles } from "./discovery";
import { createChunks, formatChunkSummary } from "./chunker";
import { runAudit } from "./orchestrator";
import { synthesizeReport } from "./report/synthesizer";
import { printReport } from "./report/terminal";
import { generateMarkdown } from "./report/markdown";
import { syncToDashboard } from "./dashboard-sync";
import { login, logout } from "./auth";
import { createProgressReporter } from "./progress";
import { formatError } from "./errors";
import { validateInput, ValidationError } from "./validation";

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

ARGUMENTS:
  <path>              Path to file or directory to audit

OPTIONS:
  --output <path>     Write report to file (default: stdout)
  --model <name>      Claude model to use (default: claude-sonnet-4-5-20250929)
  --max-tokens <n>    Maximum tokens per chunk (default: 100000)
  --no-parallel       Disable parallel processing
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

  # Use different model
  code-audit src/ --model claude-opus-4-6
`;

interface CliArgs {
  path?: string;
  output?: string;
  model?: string;
  maxTokens?: number;
  parallel?: boolean;
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
        model: { type: "string" },
        "max-tokens": { type: "string" },
        "no-parallel": { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" },
      },
      allowPositionals: true,
    });

    return {
      path: positionals[0],
      output: values.output as string | undefined,
      model: values.model as string | undefined,
      maxTokens: values["max-tokens"] ? parseInt(values["max-tokens"] as string, 10) : undefined,
      parallel: values["no-parallel"] ? false : undefined,
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
    console.log("Loading configuration...");
    const config = loadConfig({
      outputPath: args.output,
      model: args.model,
      maxTokensPerChunk: args.maxTokens,
      parallel: args.parallel,
    });
    validateConfig(config);

    console.log(`  Model: ${config.model}`);
    console.log(`  Max tokens per chunk: ${config.maxTokensPerChunk.toLocaleString()}`);
    console.log(`  Parallel processing: ${config.parallel ? "enabled" : "disabled"}`);
    if (config.outputPath) {
      console.log(`  Output: ${config.outputPath}`);
    }
    console.log();

    // Discovery phase (use validated path)
    console.log(`Discovering files in: ${validatedPath}`);
    const files = await discoverFiles(validatedPath);
    console.log(`  Found ${files.length} file${files.length === 1 ? "" : "s"}`);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`  Total size: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log();

    // Chunking phase
    console.log("Creating chunks...");
    const chunks = createChunks(files, config.maxTokensPerChunk);
    console.log(formatChunkSummary(chunks));
    console.log();

    // Run multi-agent audit with progress reporting
    // Note: For now, we run on all files as a single batch
    // In future, could iterate through chunks if needed
    const startTime = Date.now();
    const reporter = createProgressReporter();
    const agentResults = await runAudit(files, {
      model: config.model,
      maxTokens: 4096, // Per-agent response limit
      onProgress: reporter.onProgress,
    });
    const durationMs = Date.now() - startTime;

    // Synthesize report
    const report = synthesizeReport(args.path, agentResults);

    // Print to terminal
    printReport(report);

    // Save to file if requested
    if (config.outputPath) {
      const markdown = generateMarkdown(report);
      writeFileSync(config.outputPath, markdown, "utf-8");
      console.log(`\n✓ Report saved to: ${config.outputPath}\n`);
    }

    // Sync to dashboard if API key is configured
    const dashboardResult = await syncToDashboard(report, durationMs);
    if (dashboardResult) {
      console.log(`\n📊 View in dashboard: ${dashboardResult.dashboardUrl}\n`);
    }
  } catch (error) {
    console.error(formatError(error instanceof Error ? error : new Error(String(error))));
    process.exit(1);
  }
}

// Run CLI
main();
