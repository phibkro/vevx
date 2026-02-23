import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { searchPattern } from "./Search.js";

mkdirSync("/tmp/claude", { recursive: true });

// ── Helpers ──

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join("/tmp/claude/", "kart-search-"));
  // git init so .gitignore is respected
  Bun.spawnSync(["git", "init"], { cwd: tempDir });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

// ── Tests ──

describe("searchPattern", () => {
  test("finds pattern in files", async () => {
    writeFileSync(join(tempDir, "hello.ts"), 'export const greeting = "hello world";\n');
    writeFileSync(join(tempDir, "other.ts"), "export const num = 42;\n");

    const result = await searchPattern({ pattern: "greeting", rootDir: tempDir });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].path).toBe("hello.ts");
    expect(result.matches[0].line).toBe(1);
    expect(result.matches[0].text).toContain("greeting");
    expect(result.truncated).toBe(false);
  });

  test("supports regex patterns", async () => {
    writeFileSync(
      join(tempDir, "funcs.ts"),
      "export function getValue() {}\nexport function getData() {}\nexport function main() {}\n",
    );

    const result = await searchPattern({ pattern: "get\\w+", rootDir: tempDir });

    expect(result.matches).toHaveLength(2);
    const texts = result.matches.map((m) => m.text);
    expect(texts.some((t) => t.includes("getValue"))).toBe(true);
    expect(texts.some((t) => t.includes("getData"))).toBe(true);
  });

  test("filters by glob", async () => {
    writeFileSync(join(tempDir, "code.ts"), "const x = 1;\n");
    writeFileSync(join(tempDir, "readme.md"), "const x = 1;\n");

    const result = await searchPattern({ pattern: "const x", glob: "*.ts", rootDir: tempDir });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].path).toBe("code.ts");
  });

  test("respects gitignore", async () => {
    writeFileSync(join(tempDir, ".gitignore"), "ignored/\n");
    mkdirSync(join(tempDir, "ignored"), { recursive: true });
    writeFileSync(join(tempDir, "ignored", "secret.ts"), "const secret = true;\n");
    writeFileSync(join(tempDir, "visible.ts"), "const secret = false;\n");

    const result = await searchPattern({ pattern: "secret", rootDir: tempDir });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].path).toBe("visible.ts");
  });

  test("caps at 100 matches", async () => {
    const lines = Array.from({ length: 150 }, (_, i) => `const match_${i} = true;`).join("\n");
    writeFileSync(join(tempDir, "many.ts"), lines + "\n");

    const result = await searchPattern({ pattern: "match_", rootDir: tempDir });

    expect(result.matches).toHaveLength(100);
    expect(result.truncated).toBe(true);
  });

  test("returns empty for no matches", async () => {
    writeFileSync(join(tempDir, "empty.ts"), "const x = 1;\n");

    const result = await searchPattern({ pattern: "nonexistent_pattern_xyz", rootDir: tempDir });

    expect(result.matches).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});
