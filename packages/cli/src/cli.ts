#!/usr/bin/env bun

import { generateCompletions } from "./completions.js";
import { runConventionsCommand } from "./conventions.js";
import { runCouplingCommand } from "./coupling.js";
import { formatError } from "./errors.js";
import { runFreshnessCommand } from "./freshness.js";
import { runGraphCommand } from "./graph.js";
import { runInitCommand } from "./init.js";
import { runLintCommand } from "./lint.js";
import { runValidateCommand } from "./validate.js";

const VERSION = "0.1.0";

const HELP_TEXT = `
varp - Manifest-aware project tooling

USAGE:
  varp <command> [options]

COMMANDS:
  init                Scaffold a varp.yaml manifest for an existing project
  graph               Render dependency graph (ASCII by default)
  lint                Lint manifest (imports, links, freshness, stability)
  freshness           Check doc freshness across components
  validate <plan.xml> Validate plan against manifest
  coupling            Analyze component coupling (co-change + imports)
  conventions         Show component detection conventions
  completions [bash|zsh]  Generate shell completion script

GRAPH OPTIONS:
  --format <type>     ascii (default) or mermaid
  --tags              Group-by-tag view
  --no-tags           Hide tag markers
  --no-color          Use superscript numbers instead of colored dots
  --no-stability      Hide stability badges
  --direction <dir>   TD (default) or LR (mermaid only)

COMMON OPTIONS:
  --manifest <path>   Path to varp.yaml (default: ./varp.yaml)
  --version, -v       Show version number
  --help, -h          Show this help message

For compliance auditing: bun add @varp/audit && varp-audit --help

COUPLING OPTIONS:
  --files               Show file-level co-change edges with bar charts
  --hotspots            Show hidden coupling hotspots only
  --component <name>    Filter to specific component
  --no-color            Disable ANSI colors
  --format <type>       text (default) or json

EXAMPLES:
  varp init                             # Scaffold varp.yaml
  varp graph                            # ASCII dependency graph
  varp graph --format mermaid           # Mermaid diagram
  varp graph --tags                     # Components grouped by tag
  varp lint                             # Health check manifest
  varp validate plan.xml                # Validate plan
  varp coupling                         # Coupling analysis
  varp coupling --files                 # File-level edge list
  varp coupling --files --no-color      # Without ANSI colors
`;

async function run(fn: () => Promise<void>): Promise<never> {
  try {
    await fn();
    process.exit(0);
  } catch (error) {
    console.error(formatError(error instanceof Error ? error : new Error(String(error))));
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const firstArg = process.argv[2];
  const restArgs = process.argv.slice(3);

  if (firstArg === "--version" || firstArg === "-v") {
    console.log(`varp v${VERSION}`);
    return;
  }

  if (firstArg === "--help" || firstArg === "-h" || !firstArg) {
    console.log(HELP_TEXT);
    return;
  }

  if (firstArg === "completions") {
    const shell = (restArgs[0] || "bash") as "bash" | "zsh";
    if (shell !== "bash" && shell !== "zsh") {
      console.error("Error: Shell must be 'bash' or 'zsh'");
      process.exit(1);
    }
    console.log(generateCompletions(shell));
    return;
  }

  if (firstArg === "init") return run(() => runInitCommand());
  if (firstArg === "conventions") return run(() => runConventionsCommand(restArgs));
  if (firstArg === "coupling") return run(() => runCouplingCommand(restArgs));
  if (firstArg === "lint") return run(() => runLintCommand(restArgs));
  if (firstArg === "graph") return run(() => runGraphCommand(restArgs));
  if (firstArg === "freshness") return run(() => runFreshnessCommand(restArgs));
  if (firstArg === "validate") return run(() => runValidateCommand(restArgs));

  console.error(`Unknown command: ${firstArg}`);
  console.log(HELP_TEXT);
  process.exit(1);
}

void main();
