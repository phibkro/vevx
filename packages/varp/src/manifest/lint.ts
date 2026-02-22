import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import type {
  Manifest,
  ImportScanResult,
  LinkScanResult,
  FreshnessReport,
  LintReport,
  LintIssue,
} from "#shared/types.js";

import { checkFreshness } from "./freshness.js";
import { scanImports } from "./imports.js";
import { scanLinks } from "./links.js";

/** Stable key for a lint issue, used for suppressions. */
export function issueKey(issue: LintIssue): string {
  return `${issue.category}:${issue.component ?? ""}:${issue.message.replace(/\(last modified: [^)]+\)/, "(last modified: *)")}`;
}

/** Suppressions map: issue key → ISO timestamp when suppressed. */
export type LintSuppressions = Record<string, string>;

const SUPPRESSIONS_DIR = ".varp";
const SUPPRESSIONS_FILE = "lint-suppressions.json";

export function loadSuppressions(manifestDir: string): LintSuppressions {
  try {
    return JSON.parse(
      readFileSync(join(manifestDir, SUPPRESSIONS_DIR, SUPPRESSIONS_FILE), "utf-8"),
    );
  } catch {
    return {};
  }
}

export function saveSuppressions(manifestDir: string, suppressions: LintSuppressions): void {
  const dir = join(manifestDir, SUPPRESSIONS_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, SUPPRESSIONS_FILE), JSON.stringify(suppressions, null, 2) + "\n");
}

/**
 * Aggregate health checks into a unified lint report.
 * Pure function — takes pre-computed results, no I/O.
 *
 * Pass `suppressions` to filter out previously-acknowledged warnings.
 * Only warnings are suppressible — errors always surface.
 */
export function lint(
  manifest: Manifest,
  importResult: ImportScanResult,
  linkResult: LinkScanResult,
  freshnessReport: FreshnessReport,
  suppressions: LintSuppressions = {},
): LintReport {
  const issues: LintIssue[] = [];

  // ── Import issues ──

  // Undeclared import deps → error
  for (const dep of importResult.missing_deps) {
    issues.push({
      severity: "error",
      category: "imports",
      message: `Undeclared dependency: "${dep.from}" imports from "${dep.to}" but deps does not include it`,
      component: dep.from,
    });
  }

  // ── Link issues ──

  // Broken links → error
  for (const broken of linkResult.broken_links) {
    issues.push({
      severity: "error",
      category: "links",
      message: `Broken link in ${broken.source_doc}: [${broken.link_text}](${broken.link_target}) — ${broken.reason}`,
      component: broken.source_component,
    });
  }

  // Undeclared link deps → warning
  for (const dep of linkResult.missing_deps) {
    issues.push({
      severity: "warning",
      category: "links",
      message: `Undeclared dependency (from links): "${dep.from}" links to "${dep.to}" but deps does not include it`,
      component: dep.from,
    });
  }

  // ── Composed unused-dep check ──
  // A declared dep is only "unused" if BOTH signals agree it's extra.
  // If imports justify it but links don't (or vice versa), no warning.
  const importExtraSet = new Set(importResult.extra_deps.map((d) => `${d.from}→${d.to}`));
  const linkExtraSet = new Set(linkResult.extra_deps.map((d) => `${d.from}→${d.to}`));
  const sourceComponents = new Set(importResult.components_with_source);

  // Union of all extra deps from both signals
  const allExtraKeys = new Set([...importExtraSet, ...linkExtraSet]);
  for (const key of allExtraKeys) {
    const [from, to] = key.split("→");
    const unusedByImports = importExtraSet.has(key) && sourceComponents.has(from);
    const unusedByLinks = linkExtraSet.has(key);

    // Skip if either signal justifies the dep
    if (!unusedByImports || !unusedByLinks) continue;

    issues.push({
      severity: "warning",
      category: "deps",
      message: `Unused dependency: "${from}" declares dep on "${to}" but no imports or links found`,
      component: from,
    });
  }

  // ── Freshness issues ──

  for (const [compName, comp] of Object.entries(freshnessReport.components)) {
    for (const [docName, doc] of Object.entries(comp.docs)) {
      if (doc.stale) {
        issues.push({
          severity: "warning",
          category: "freshness",
          message: `Stale doc: "${docName}" in component "${compName}" (last modified: ${doc.last_modified})`,
          component: compName,
        });
      }
    }
  }

  // ── Stability issues ──

  // Build reverse-dep map: component → components that depend on it
  const reverseDeps = new Map<string, string[]>();
  for (const [name, comp] of Object.entries(manifest.components)) {
    for (const dep of comp.deps ?? []) {
      const existing = reverseDeps.get(dep) ?? [];
      existing.push(name);
      reverseDeps.set(dep, existing);
    }
  }

  for (const [compName, comp] of Object.entries(manifest.components)) {
    // Stable component with no explicit test command → warning
    if (comp.stability === "stable" && !comp.test) {
      issues.push({
        severity: "warning",
        category: "stability",
        message: `Stable component "${compName}" has no explicit test command — relies on auto-discovery`,
        component: compName,
      });
    }

    // Experimental component depended on by stable components → warning
    if (comp.stability === "experimental") {
      const dependents = reverseDeps.get(compName) ?? [];
      for (const depName of dependents) {
        const dependent = manifest.components[depName];
        if (dependent?.stability === "stable") {
          issues.push({
            severity: "warning",
            category: "stability",
            message: `Experimental component "${compName}" is a dependency of stable component "${depName}"`,
            component: compName,
          });
        }
      }
    }
  }

  // ── Apply suppressions (warnings only) ──
  const filtered = issues.filter((issue) => {
    if (issue.severity === "error") return true;
    return !suppressions[issueKey(issue)];
  });

  return {
    total_issues: filtered.length,
    issues: filtered,
  };
}

/**
 * Run all lint checks against a manifest.
 * Effectful wrapper — calls scanImports, scanLinks, checkFreshness, then delegates to pure lint().
 * Loads suppressions from `.varp/lint-suppressions.json`.
 */
export async function runLint(manifest: Manifest, manifestPath: string): Promise<LintReport> {
  const manifestDir = dirname(resolve(manifestPath));
  const importResult = scanImports(manifest, manifestDir);
  const linkResult = scanLinks(manifest, "all");
  const freshnessReport = checkFreshness(manifest, manifestDir);
  const suppressions = loadSuppressions(manifestDir);

  return lint(manifest, importResult, linkResult, freshnessReport, suppressions);
}
