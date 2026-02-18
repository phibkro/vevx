import { resolve } from "path";

import { parseManifest, renderGraph } from "@varp/core/lib";

import { DEFAULT_MANIFEST, parseEnum } from "./args.js";

export interface GraphArgs {
  manifest: string;
  direction: "TD" | "LR";
}

export function parseGraphArgs(argv: string[]): GraphArgs {
  let manifest = DEFAULT_MANIFEST;
  let direction: "TD" | "LR" = "TD";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--direction" && argv[i + 1]) {
      direction = parseEnum(argv[++i].toUpperCase(), ["TD", "LR"] as const, "direction");
    }
  }

  return { manifest, direction };
}

export async function runGraphCommand(argv: string[]): Promise<void> {
  const args = parseGraphArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifest = parseManifest(manifestPath);
  const mermaid = renderGraph(manifest, { direction: args.direction });
  console.log(mermaid);
}
