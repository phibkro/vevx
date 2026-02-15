#!/usr/bin/env bun

import { parseArgs } from "util";
import { writeFileSync } from "fs";
import { loadConfig, validateConfig, type Config } from "./config.ts";
import { discoverFiles } from "./discovery.ts";
import { createChunks, formatChunkSummary } from "./chunker.ts";
import { runAudit } from "./orchestrator.ts";
import { synthesizeReport } from "./report/synthesizer.ts";
import { printReport } from "./report/terminal.ts";
import { generateMarkdown } from "./report/markdown.ts";
import { syncToDashboard } from "./dashboard-sync.ts";

const HELP_TEXT = `
AI Code Auditor - Multi-agent code quality analysis tool

USAGE:
  code-auditor <path> [options]
  bun run src/cli.ts <path> [options]

ARGUMENTS:
  <path>              Path to file or directory to audit

OPTIONS:
  --output <path>     Write report to file (default: stdout)
  --model <name>      Claude model to use (default: claude-sonnet-4-5-20250929)
  --max-tokens <n>    Maximum tokens per chunk (default: 100000)
  --no-parallel       Disable parallel processing
  --help, -h          Show this help message

ENVIRONMENT:
  ANTHROPIC_API_KEY   Required. Your Anthropic API key

CONFIGURATION:
  Create a .code-auditor.json file in your project directory:
  {
    "model": "claude-sonnet-4-5-20250929",
    "maxTokensPerChunk": 100000,
    "parallel": true
  }

EXAMPLES:
  # Audit a single file
  code-auditor src/main.ts

  # Audit entire directory
  code-auditor src/

  # Save report to file
  code-auditor src/ --output report.md

  # Use different model
  code-auditor src/ --model claude-opus-4-6
`;

interface CliArgs {
  path?: string;
  output?: string;
  model?: string;
  maxTokens?: number;
  parallel?: boolean;
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
  // Parse CLI arguments
  const args = parseCliArgs();

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

    // Validate API key early
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error(
        "ANTHROPIC_API_KEY environment variable is not set.\n" +
          "Please set it with: export ANTHROPIC_API_KEY='your-api-key'"
      );
    }

    // Discovery phase
    console.log(`Discovering files in: ${args.path}`);
    const files = await discoverFiles(args.path);
    console.log(`  Found ${files.length} file${files.length === 1 ? "" : "s"}`);

    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`  Total size: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log();

    // Chunking phase
    console.log("Creating chunks...");
    const chunks = createChunks(files, config.maxTokensPerChunk);
    console.log(formatChunkSummary(chunks));
    console.log();

    // Run multi-agent audit
    // Note: For now, we run on all files as a single batch
    // In future, could iterate through chunks if needed
    const startTime = Date.now();
    const agentResults = await runAudit(files, {
      model: config.model,
      maxTokens: 4096, // Per-agent response limit
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
    console.error("\n✗ Error:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Run CLI
main();
