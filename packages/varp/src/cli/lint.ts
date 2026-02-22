import { dirname, resolve } from "path";

import { issueKey, loadSuppressions, parseManifest, runLint, saveSuppressions } from "../lib.js";
import { DEFAULT_MANIFEST, parseEnum } from "./args.js";

export interface LintArgs {
  manifest: string;
  format: "text" | "json";
  suppress: boolean;
  details: boolean;
}

export function parseLintArgs(argv: string[]): LintArgs {
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";
  let suppress = false;
  let details = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i], ["text", "json"] as const, "format");
    } else if (arg === "--suppress") {
      suppress = true;
    } else if (arg === "--details") {
      details = true;
    }
  }

  return { manifest, format, suppress, details };
}

export async function runLintCommand(argv: string[]): Promise<void> {
  const args = parseLintArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifestDir = dirname(manifestPath);
  const manifest = parseManifest(manifestPath);
  const report = await runLint(manifest, manifestPath);

  if (args.suppress) {
    // Suppress all current warnings
    const existing = loadSuppressions(manifestDir);
    let count = 0;
    for (const issue of report.issues) {
      if (issue.severity !== "warning") continue;
      const key = issueKey(issue);
      if (!existing[key]) {
        existing[key] = new Date().toISOString();
        count++;
      }
    }
    saveSuppressions(manifestDir, existing);
    console.log(
      `Suppressed ${count} new warning(s). ${Object.keys(existing).length} total suppression(s).`,
    );
    return;
  }

  if (args.format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.total_issues === 0) {
    console.log("No issues found.");
    return;
  }

  if (args.details) {
    // Group by category for detailed view
    const byCategory = new Map<string, typeof report.issues>();
    for (const issue of report.issues) {
      const list = byCategory.get(issue.category) ?? [];
      list.push(issue);
      byCategory.set(issue.category, list);
    }

    for (const [category, issues] of byCategory) {
      const errors = issues.filter((i) => i.severity === "error").length;
      const warnings = issues.length - errors;
      console.log(`\n── ${category} (${errors} error(s), ${warnings} warning(s)) ──\n`);
      for (const issue of issues) {
        const prefix = issue.severity === "error" ? "ERROR" : "WARN ";
        const comp = issue.component ? ` [${issue.component}]` : "";
        console.log(`  ${prefix}${comp}: ${issue.message}`);
      }
    }
    console.log(`\n${report.total_issues} issue(s) total.`);
  } else {
    // Default: compact summary
    const errors = report.issues.filter((i) => i.severity === "error");
    const warnings = report.issues.filter((i) => i.severity === "warning");

    if (errors.length > 0) {
      console.log(`${errors.length} error(s):\n`);
      for (const issue of errors) {
        const comp = issue.component ? ` [${issue.component}]` : "";
        console.log(`  ERROR (${issue.category})${comp}: ${issue.message}`);
      }
    }

    if (warnings.length > 0) {
      // Summarize warnings by category
      const warnCounts = new Map<string, number>();
      for (const w of warnings) {
        warnCounts.set(w.category, (warnCounts.get(w.category) ?? 0) + 1);
      }
      const summary = [...warnCounts.entries()].map(([c, n]) => `${n} ${c}`).join(", ");
      console.log(`\n${warnings.length} warning(s): ${summary}`);
      console.log("Use --details to see all warnings, --suppress to dismiss.");
    }
  }

  const errors = report.issues.filter((i) => i.severity === "error").length;
  if (errors > 0) {
    process.exit(1);
  }
}
