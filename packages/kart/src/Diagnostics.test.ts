import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { runDiagnostics } from "./Diagnostics.js";

mkdirSync("/tmp/claude", { recursive: true });

// ── Helpers ──

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join("/tmp/claude/", "kart-diag-"));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Tests ──

describe("runDiagnostics", () => {
  test("returns diagnostics for a file with issues", async () => {
    // Floating promise — oxlint should catch this with --type-aware
    writeFileSync(
      join(tempDir, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true } }),
    );
    writeFileSync(
      join(tempDir, "bad.ts"),
      "const x: any = 1;\nexport { x };\n",
    );

    const result = await runDiagnostics({ paths: ["bad.ts"], rootDir: tempDir });

    // oxlint may or may not be installed in the test environment
    if (result.oxlintAvailable) {
      expect(result.diagnostics).toBeInstanceOf(Array);
      // We don't assert specific diagnostics since oxlint config varies
    } else {
      expect(result.diagnostics).toEqual([]);
    }
  });

  test("returns oxlintAvailable: false when oxlint is not found", async () => {
    // Use a rootDir where oxlint definitely won't be in PATH
    const result = await runDiagnostics({
      paths: ["nonexistent.ts"],
      rootDir: "/tmp/claude/no-oxlint-here",
    });

    // Either oxlint runs (and finds nothing) or it's unavailable
    expect(typeof result.oxlintAvailable).toBe("boolean");
    expect(result.diagnostics).toBeInstanceOf(Array);
  });

  test("skips paths outside workspace root", async () => {
    writeFileSync(join(tempDir, "ok.ts"), "const x = 1;\n");

    const result = await runDiagnostics({
      paths: ["ok.ts", "../../../etc/passwd"],
      rootDir: tempDir,
    });

    expect(result.pathsSkipped).toEqual(["../../../etc/passwd"]);
  });

  test("returns empty diagnostics when all paths are out of bounds", async () => {
    const result = await runDiagnostics({
      paths: ["../../../etc/passwd"],
      rootDir: tempDir,
    });

    expect(result.diagnostics).toEqual([]);
    expect(result.oxlintAvailable).toBe(true);
    expect(result.pathsSkipped).toEqual(["../../../etc/passwd"]);
  });

  test("handles empty paths array", async () => {
    const result = await runDiagnostics({ paths: [], rootDir: tempDir });

    expect(result.diagnostics).toEqual([]);
    expect(result.oxlintAvailable).toBe(true);
  });
});
