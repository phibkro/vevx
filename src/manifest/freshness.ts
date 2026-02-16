import { statSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Manifest, FreshnessReport } from "../types.js";

function getLatestMtime(dirPath: string): Date | null {
  try {
    const entries = readdirSync(dirPath, {
      withFileTypes: true,
      recursive: true,
    });
    let latest: Date | null = null;
    for (const entry of entries) {
      if (entry.isFile()) {
        const fullPath = join((entry as any).parentPath ?? dirPath, entry.name);
        try {
          const stat = statSync(fullPath);
          if (!latest || stat.mtime > latest) {
            latest = stat.mtime;
          }
        } catch {
          /* skip unreadable files */
        }
      }
    }
    return latest;
  } catch {
    return null;
  }
}

function getFileMtime(filePath: string): Date | null {
  try {
    return statSync(filePath).mtime;
  } catch {
    return null;
  }
}

export function checkFreshness(manifest: Manifest): FreshnessReport {
  const components: FreshnessReport["components"] = {};

  for (const [name, component] of Object.entries(manifest.components)) {
    const sourceMtime = getLatestMtime(component.path);
    const interfaceMtime = getFileMtime(component.docs.interface);
    const internalMtime = getFileMtime(component.docs.internal);

    const sourceTs = sourceMtime?.toISOString() ?? "N/A";

    components[name] = {
      interface_doc: {
        path: component.docs.interface,
        last_modified: interfaceMtime?.toISOString() ?? "N/A",
        stale: !interfaceMtime || !sourceMtime || interfaceMtime < sourceMtime,
      },
      internal_doc: {
        path: component.docs.internal,
        last_modified: internalMtime?.toISOString() ?? "N/A",
        stale: !internalMtime || !sourceMtime || internalMtime < sourceMtime,
      },
      source_last_modified: sourceTs,
    };
  }

  return { components };
}
