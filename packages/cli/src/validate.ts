import { resolve, dirname } from "path";

import {
  parseManifest,
  parsePlanFile,
  validatePlan,
  detectHazards,
  scanImports,
} from "@varp/core/lib";

import { DEFAULT_MANIFEST, parseEnum } from "./args.js";

export interface ValidateArgs {
  planPath: string;
  manifest: string;
  format: "text" | "json";
}

export function parseValidateArgs(argv: string[]): ValidateArgs {
  let planPath: string | undefined;
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i], ["text", "json"] as const, "format");
    } else if (!arg.startsWith("-") && !planPath) {
      planPath = arg;
    }
  }

  if (!planPath) {
    throw new Error("Plan path is required.\nUsage: varp validate <plan.xml> [--manifest <path>]");
  }

  return { planPath, manifest, format };
}

export async function runValidateCommand(argv: string[]): Promise<void> {
  const args = parseValidateArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifest = parseManifest(manifestPath);
  const plan = parsePlanFile(resolve(args.planPath));
  const hazards = detectHazards(plan.tasks);
  const { import_deps } = scanImports(manifest, dirname(manifestPath));
  const result = validatePlan(plan, manifest, hazards, import_deps);

  if (args.format === "json") {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.valid) {
    console.log("Plan is valid.");
  } else {
    console.log("Plan validation failed.\n");
  }

  if (result.errors.length > 0) {
    console.log("Errors:");
    for (const err of result.errors) {
      console.log(`  ERROR: ${err}`);
    }
  }

  if (result.warnings.length > 0) {
    if (result.errors.length > 0) console.log();
    console.log("Warnings:");
    for (const warn of result.warnings) {
      console.log(`  WARN:  ${warn}`);
    }
  }

  if (!result.valid) {
    process.exit(1);
  }
}
