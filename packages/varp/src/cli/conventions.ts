import { DEFAULT_DETECTION_CONFIG } from "../lib.js";
import { parseEnum } from "./args.js";

export interface ConventionsArgs {
  format: "text" | "json";
}

export function parseConventionsArgs(argv: string[]): ConventionsArgs {
  let format: "text" | "json" = "text";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i], ["text", "json"] as const, "format");
    }
  }

  return { format };
}

export async function runConventionsCommand(argv: string[]): Promise<void> {
  const args = parseConventionsArgs(argv);
  const config = DEFAULT_DETECTION_CONFIG;

  if (args.format === "json") {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  console.log("Component Detection Conventions");
  console.log("===============================\n");

  console.log("Container dirs (subdirs are components):");
  console.log(`  ${config.containerDirs.join(", ")}\n`);

  console.log("Indicator dirs (parent is a component):");
  console.log(`  ${config.indicatorDirs.join(", ")}\n`);

  console.log("Layer dirs (MVC-style cross-layer detection):");
  console.log(`  ${config.layerDirs.join(", ")}\n`);

  console.log("File suffixes (stripped for stem matching):");
  console.log(`  ${config.suffixes.join(", ")}\n`);

  console.log("Code extensions:");
  console.log(`  ${config.codeExtensions.join(", ")}`);
}
