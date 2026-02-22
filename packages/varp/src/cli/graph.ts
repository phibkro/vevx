import { resolve } from "path";

import {
  type AsciiGraphOptions,
  parseManifest,
  renderAsciiGraph,
  renderGraph,
  renderTagGroups,
} from "../lib.js";
import { DEFAULT_MANIFEST, parseEnum } from "./args.js";

export interface GraphArgs {
  manifest: string;
  direction: "TD" | "LR";
  format: "ascii" | "mermaid";
  tags: "color" | "superscript" | "group" | false;
  stability: boolean;
}

export function parseGraphArgs(argv: string[]): GraphArgs {
  let manifest = DEFAULT_MANIFEST;
  let direction: "TD" | "LR" = "TD";
  let format: "ascii" | "mermaid" = "ascii";
  let tags: GraphArgs["tags"] = "color";
  let stability = true;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--direction" && argv[i + 1]) {
      direction = parseEnum(argv[++i].toUpperCase(), ["TD", "LR"] as const, "direction");
    } else if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i].toLowerCase(), ["ascii", "mermaid"] as const, "format");
    } else if (arg === "--tags") {
      tags = "group";
    } else if (arg === "--no-tags") {
      tags = false;
    } else if (arg === "--no-color") {
      if (tags === "color") tags = "superscript";
    } else if (arg === "--no-stability") {
      stability = false;
    }
  }

  return { manifest, direction, format, tags, stability };
}

export async function runGraphCommand(argv: string[]): Promise<void> {
  const args = parseGraphArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifest = parseManifest(manifestPath);

  if (args.format === "mermaid") {
    console.log(renderGraph(manifest, { direction: args.direction }));
    return;
  }

  if (args.tags === "group") {
    console.log(renderTagGroups(manifest));
    return;
  }

  const opts: AsciiGraphOptions = {
    tags: args.tags,
    stability: args.stability,
  };
  console.log(renderAsciiGraph(manifest, opts));
}
