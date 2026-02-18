import { parseManifest, renderGraph } from "@varp/core/bun";
import { resolve } from "path";

export interface GraphArgs {
  manifest: string;
  direction: "TD" | "LR";
}

export function parseGraphArgs(argv: string[]): GraphArgs {
  let manifest = "./varp.yaml";
  let direction: "TD" | "LR" = "TD";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--direction" && argv[i + 1]) {
      const d = argv[++i].toUpperCase();
      if (d === "TD" || d === "LR") {
        direction = d;
      } else {
        throw new Error(`Invalid direction: ${d}. Must be TD or LR`);
      }
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
