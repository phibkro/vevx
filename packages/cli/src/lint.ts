import { parseManifest, runLint } from "@varp/core/lib";
import { resolve } from "path";

export interface LintArgs {
  manifest: string;
  format: "text" | "json";
}

export function parseLintArgs(argv: string[]): LintArgs {
  let manifest = "./varp.yaml";
  let format: "text" | "json" = "text";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      const f = argv[++i];
      if (f === "text" || f === "json") {
        format = f;
      } else {
        throw new Error(`Invalid format: ${f}. Must be text or json`);
      }
    }
  }

  return { manifest, format };
}

export async function runLintCommand(argv: string[]): Promise<void> {
  const args = parseLintArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifest = parseManifest(manifestPath);
  const report = await runLint(manifest, manifestPath);

  if (args.format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  if (report.total_issues === 0) {
    console.log("No issues found.");
    return;
  }

  console.log(`Found ${report.total_issues} issue(s):\n`);
  for (const issue of report.issues) {
    const prefix = issue.severity === "error" ? "ERROR" : "WARN ";
    const comp = issue.component ? ` [${issue.component}]` : "";
    console.log(`  ${prefix} (${issue.category})${comp}: ${issue.message}`);
  }

  const errors = report.issues.filter((i) => i.severity === "error").length;
  if (errors > 0) {
    process.exit(1);
  }
}
