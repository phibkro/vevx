import { readdirSync, existsSync } from "node:fs";
import { resolve, relative } from "node:path";

import type { Manifest, ScopedTestResult } from "../types.js";

/**
 * Recursively find all *.test.ts files under a directory.
 * Returns absolute paths.
 */
function findTestFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];

  const results: string[] = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...findTestFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        results.push(fullPath);
      }
    }
  } catch {
    /* skip unreadable dirs */
  }
  return results;
}

/**
 * Find test files for a given touches declaration.
 *
 * - For each component in `writes`: recursively find all *.test.ts files under the component's path
 * - For each component in `reads`: optionally include test files when `includeReadTests` is true
 * - Returns test file paths, covered components, and the bun test invocation command
 */
export function findScopedTests(
  manifest: Manifest,
  touches: { reads?: string[]; writes?: string[] },
  manifestDir: string,
  includeReadTests: boolean = false,
): ScopedTestResult {
  const componentNames = new Set<string>();
  const testFileSet = new Set<string>();

  // Always include write components
  for (const name of touches.writes ?? []) {
    const comp = manifest.components[name];
    if (!comp) continue;
    componentNames.add(name);
    for (const file of findTestFiles(comp.path)) {
      testFileSet.add(file);
    }
  }

  // Optionally include read components
  if (includeReadTests) {
    for (const name of touches.reads ?? []) {
      const comp = manifest.components[name];
      if (!comp) continue;
      componentNames.add(name);
      for (const file of findTestFiles(comp.path)) {
        testFileSet.add(file);
      }
    }
  }

  const testFiles = [...testFileSet].sort();
  const componentsCovered = [...componentNames].sort();

  // Build run command with paths relative to manifestDir for readability
  const relativePaths = testFiles.map((f) => relative(manifestDir, f));
  const runCommand = testFiles.length > 0 ? `bun test ${relativePaths.join(" ")}` : "";

  return {
    test_files: testFiles,
    components_covered: componentsCovered,
    run_command: runCommand,
  };
}
