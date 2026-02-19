#!/usr/bin/env bun

import { runAuditCommand } from "./cli/audit.js";
import { login, logout } from "./cli/auth.js";

const HELP_TEXT = `
varp-audit - AI-powered compliance auditing

USAGE:
  varp-audit <command> [options]

COMMANDS:
  audit <path>        Run compliance audit against a ruleset
  login               Save API key for dashboard syncing
  logout              Remove saved API key

AUDIT OPTIONS:
  --ruleset <name>    Ruleset name or path (default: owasp-top-10)
  --model <name>      Claude model (default: claude-sonnet-4-5-20250929)
  --concurrency <n>   Max parallel API calls per wave (default: 5)
  --format <type>     Output format: text, json, markdown (default: text)
  --output <path>     Write report to file (default: stdout)
  --quiet             Suppress progress output
  --diff [ref]        Incremental audit — only changed files (default ref: HEAD)
  --budget <tokens>   Max estimated tokens; skips low-priority tasks when exceeded
  --baseline <path>   Compare against a previous report JSON for drift tracking

COMMON OPTIONS:
  --version, -v       Show version number
  --help, -h          Show this help message

ENVIRONMENT:
  CODE_AUDITOR_API_KEY    Optional. Dashboard API key (or use 'login')

EXAMPLES:
  varp-audit audit src/                          # Full OWASP audit
  varp-audit audit src/ --diff                   # Incremental audit
  varp-audit audit src/ --format json -o report  # JSON report to file
  varp-audit audit src/ --baseline prev.json     # Drift comparison
  varp-audit login                               # Save dashboard API key
`;

function formatError(error: Error): string {
  return `\nError: ${error.message}\n`;
}

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
    console.log("varp-audit v0.1.0");
    return;
  }

  if (firstArg === "--help" || firstArg === "-h" || !firstArg) {
    console.log(HELP_TEXT);
    return;
  }

  if (firstArg === "login") return run(() => login());
  if (firstArg === "logout") {
    logout();
    return;
  }

  if (firstArg === "audit") return run(() => runAuditCommand(restArgs));

  console.error(`Unknown command: ${firstArg}`);
  console.log(HELP_TEXT);
  process.exit(1);
}

void main();
