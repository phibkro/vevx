import { resolve } from "path";

import { parseManifest, checkFreshness } from "@varp/core/lib";

import { DEFAULT_MANIFEST, parseEnum } from "./args.js";

export interface FreshnessArgs {
  manifest: string;
  format: "text" | "json";
}

export function parseFreshnessArgs(argv: string[]): FreshnessArgs {
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      format = parseEnum(argv[++i], ["text", "json"] as const, "format");
    }
  }

  return { manifest, format };
}

export async function runFreshnessCommand(argv: string[]): Promise<void> {
  const args = parseFreshnessArgs(argv);
  const manifestPath = resolve(args.manifest);
  const manifest = parseManifest(manifestPath);
  const report = checkFreshness(manifest);

  if (args.format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const components = Object.entries(report.components);
  if (components.length === 0) {
    console.log("No components with docs found.");
    return;
  }

  let staleCount = 0;
  for (const [name, comp] of components) {
    const docs = Object.entries(comp.docs);
    const staleDocs = docs.filter(([, d]) => d.stale);
    if (staleDocs.length > 0) {
      staleCount += staleDocs.length;
      console.log(`${name}:`);
      for (const [docPath, doc] of staleDocs) {
        console.log(`  STALE  ${docPath} (last modified: ${doc.last_modified})`);
      }
    }
  }

  if (staleCount === 0) {
    console.log("All docs are fresh.");
  } else {
    console.log(`\n${staleCount} stale doc(s) found.`);
  }
}
