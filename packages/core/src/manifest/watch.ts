import type { Manifest, WatchFreshnessResult } from "#shared/types.js";

import { checkFreshness } from "./freshness.js";

/**
 * Check freshness and filter to changes since a baseline timestamp.
 * If `since` is omitted, returns the full freshness snapshot.
 */
export function watchFreshness(manifest: Manifest, since?: string): WatchFreshnessResult {
  const report = checkFreshness(manifest);
  const snapshotTime = new Date().toISOString();
  const sinceDate = since ? new Date(since) : null;

  const changes: WatchFreshnessResult["changes"] = [];
  let totalStale = 0;

  for (const [compName, comp] of Object.entries(report.components)) {
    for (const [docKey, doc] of Object.entries(comp.docs)) {
      if (doc.stale) totalStale++;

      // If no baseline, include everything that's stale
      if (!sinceDate) {
        if (doc.stale) {
          changes.push({
            component: compName,
            doc: docKey,
            became_stale: true,
            source_modified: comp.source_last_modified,
            doc_modified: doc.last_modified,
          });
        }
        continue;
      }

      // With baseline: include only docs/sources modified after `since`
      const sourceModified =
        comp.source_last_modified !== "N/A" ? new Date(comp.source_last_modified) : null;
      const docModified = doc.last_modified !== "N/A" ? new Date(doc.last_modified) : null;

      const sourceChangedSince = sourceModified && sourceModified > sinceDate;
      const docChangedSince = docModified && docModified > sinceDate;

      if (sourceChangedSince || docChangedSince) {
        changes.push({
          component: compName,
          doc: docKey,
          became_stale: doc.stale,
          source_modified: comp.source_last_modified,
          doc_modified: doc.last_modified,
        });
      }
    }
  }

  return {
    changes,
    snapshot_time: snapshotTime,
    total_stale: totalStale,
  };
}
