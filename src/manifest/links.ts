import { resolve, dirname } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import type { Manifest, BrokenLink, InferredDep, LinkScanResult } from "../types.js";
import { discoverDocs } from "./discovery.js";
import { findOwningComponent, buildComponentPaths } from "../ownership.js";

export type LinkScanMode = "deps" | "integrity" | "all";

interface RawLink {
  text: string;
  target: string;
}

/**
 * Extract relative markdown links from content.
 * Filters out http(s):// URLs and #-only anchors.
 */
export function extractMarkdownLinks(content: string): RawLink[] {
  const regex = /\[([^\]]*)\]\(([^)]+)\)/g;
  const links: RawLink[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(content)) !== null) {
    const target = match[2];
    if (/^https?:\/\//.test(target) || target.startsWith("#")) {
      continue;
    }
    links.push({ text: match[1], target });
  }

  return links;
}

/**
 * Resolve a relative link target to an absolute path.
 * Strips #anchor fragments before resolving.
 */
export function resolveLink(target: string, sourceDocPath: string): string {
  const withoutAnchor = target.replace(/#.*$/, "");
  return resolve(dirname(sourceDocPath), withoutAnchor);
}

// ── Pure analysis ──

export type DocContent = { path: string; component: string; content: string };

/**
 * Analyze pre-loaded docs for broken links and dependency inference.
 * Pure function — no I/O, fully testable with synthetic data.
 * Accepts a fileExists predicate for integrity checking without filesystem access.
 */
export function analyzeLinks(
  docs: DocContent[],
  manifest: Manifest,
  mode: LinkScanMode,
  fileExists: (path: string) => boolean,
): LinkScanResult {
  const brokenLinks: BrokenLink[] = [];
  const inferredDepsMap = new Map<
    string,
    { from: string; to: string; evidence: { source_doc: string; link_target: string }[] }
  >();
  let totalLinksScanned = 0;

  const checkIntegrity = mode === "integrity" || mode === "all";
  const checkDeps = mode === "deps" || mode === "all";
  const componentPaths = buildComponentPaths(manifest);

  for (const doc of docs) {
    const links = extractMarkdownLinks(doc.content);

    for (const link of links) {
      totalLinksScanned++;
      const resolved = resolveLink(link.target, doc.path);

      if (checkIntegrity && !fileExists(resolved)) {
        brokenLinks.push({
          source_doc: doc.path,
          source_component: doc.component,
          link_text: link.text,
          link_target: link.target,
          resolved_path: resolved,
          reason: "file not found",
        });
      }

      if (checkDeps) {
        const targetOwner = findOwningComponent(resolved, manifest, componentPaths);
        if (targetOwner !== null && targetOwner !== doc.component) {
          const key = `${doc.component}->${targetOwner}`;
          const existing = inferredDepsMap.get(key);
          if (existing) {
            existing.evidence.push({ source_doc: doc.path, link_target: link.target });
          } else {
            inferredDepsMap.set(key, {
              from: doc.component,
              to: targetOwner,
              evidence: [{ source_doc: doc.path, link_target: link.target }],
            });
          }
        }
      }
    }
  }

  const inferredDeps: InferredDep[] = Array.from(inferredDepsMap.values());

  // Compare inferred deps against declared deps
  const declaredDepsSet = new Set<string>();
  for (const [compName, comp] of Object.entries(manifest.components)) {
    for (const dep of comp.deps ?? []) {
      declaredDepsSet.add(`${compName}->${dep}`);
    }
  }

  const inferredKeys = new Set(inferredDepsMap.keys());
  const missingDeps = inferredDeps.filter((d) => !declaredDepsSet.has(`${d.from}->${d.to}`));
  const extraDeps: { from: string; to: string }[] = [];
  for (const declared of declaredDepsSet) {
    if (!inferredKeys.has(declared)) {
      const [from, to] = declared.split("->");
      extraDeps.push({ from, to });
    }
  }

  return {
    inferred_deps: inferredDeps,
    missing_deps: missingDeps,
    extra_deps: extraDeps,
    broken_links: brokenLinks,
    missing_docs: [],
    total_links_scanned: totalLinksScanned,
    total_docs_scanned: docs.length,
  };
}

// ── Effectful wrapper ──

/**
 * Scan all component docs for markdown links.
 * Loads docs from disk, then delegates to pure analyzeLinks().
 */
export function scanLinks(manifest: Manifest, mode: LinkScanMode): LinkScanResult {
  const missingDocs: string[] = [];
  const docs: DocContent[] = [];

  for (const [compName, comp] of Object.entries(manifest.components)) {
    const docPaths = discoverDocs(comp);

    for (const docPath of docPaths) {
      if (!existsSync(docPath)) {
        missingDocs.push(docPath);
        continue;
      }

      try {
        const content = readFileSync(docPath, "utf-8");
        docs.push({ path: docPath, component: compName, content });
      } catch {
        continue;
      }
    }
  }

  const result = analyzeLinks(docs, manifest, mode, existsSync);
  result.missing_docs = missingDocs;
  return result;
}
