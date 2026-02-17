import { dirname, resolve } from "node:path";

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

/**
 * Aggregate health checks into a unified lint report.
 * Pure function — takes pre-computed results, no I/O.
 */
export function lint(
  manifest: Manifest,
  importResult: ImportScanResult,
  linkResult: LinkScanResult,
  freshnessReport: FreshnessReport,
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

  // Unused declared deps (from import perspective) → warning
  for (const dep of importResult.extra_deps) {
    issues.push({
      severity: "warning",
      category: "imports",
      message: `Unused dependency: "${dep.from}" declares dep on "${dep.to}" but no imports found`,
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

  // Unused declared deps (from links perspective) → warning
  for (const dep of linkResult.extra_deps) {
    issues.push({
      severity: "warning",
      category: "links",
      message: `Unused dependency (from links): "${dep.from}" declares dep on "${dep.to}" but no links found`,
      component: dep.from,
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

  return {
    total_issues: issues.length,
    issues,
  };
}

/**
 * Run all lint checks against a manifest.
 * Effectful wrapper — calls scanImports, scanLinks, checkFreshness, then delegates to pure lint().
 */
export async function runLint(manifest: Manifest, manifestPath: string): Promise<LintReport> {
  const importResult = scanImports(manifest, dirname(resolve(manifestPath)));
  const linkResult = scanLinks(manifest, "all");
  const freshnessReport = checkFreshness(manifest);

  return lint(manifest, importResult, linkResult, freshnessReport);
}
