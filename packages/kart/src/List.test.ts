import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

import { listDirectory } from "./List.js";

mkdirSync("/tmp/claude", { recursive: true });

// ── Helpers ──

function withTempDir(fn: (dir: string) => void): () => void {
  return () => {
    const dir = mkdtempSync("/tmp/claude/kart-list-");
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

// ── Tests ──

describe("listDirectory", () => {
  test(
    "lists files and directories (non-recursive)",
    withTempDir((dir) => {
      writeFileSync(join(dir, "a.ts"), "export const a = 1;");
      writeFileSync(join(dir, "b.txt"), "hello");
      mkdirSync(join(dir, "sub"));

      const result = listDirectory({ path: ".", rootDir: dir });

      expect(result.entries).toHaveLength(3);
      expect(result.truncated).toBe(false);

      const names = result.entries.map((e) => e.name);
      expect(names).toContain("a.ts");
      expect(names).toContain("b.txt");
      expect(names).toContain("sub");

      const subEntry = result.entries.find((e) => e.name === "sub")!;
      expect(subEntry.isDirectory).toBe(true);
      expect(subEntry.size).toBeUndefined();

      const fileEntry = result.entries.find((e) => e.name === "a.ts")!;
      expect(fileEntry.isDirectory).toBe(false);
    }),
  );

  test(
    "recursive mode lists nested files only",
    withTempDir((dir) => {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "root.ts"), "x");
      writeFileSync(join(dir, "src", "nested.ts"), "y");

      const result = listDirectory({ path: ".", rootDir: dir, recursive: true });

      expect(result.entries.every((e) => !e.isDirectory)).toBe(true);
      const paths = result.entries.map((e) => e.path);
      expect(paths).toContain("root.ts");
      expect(paths).toContain(join("src", "nested.ts"));
    }),
  );

  test(
    "glob filter returns only matching files",
    withTempDir((dir) => {
      writeFileSync(join(dir, "a.ts"), "export const a = 1;");
      writeFileSync(join(dir, "b.txt"), "hello");
      writeFileSync(join(dir, "c.ts"), "export const c = 3;");

      const result = listDirectory({ path: ".", rootDir: dir, glob: "*.ts" });

      const names = result.entries.map((e) => e.name);
      expect(names).toEqual(["a.ts", "c.ts"]);
    }),
  );

  test(
    "excludes node_modules",
    withTempDir((dir) => {
      mkdirSync(join(dir, "node_modules"));
      writeFileSync(join(dir, "node_modules", "pkg.js"), "module");
      writeFileSync(join(dir, "app.ts"), "code");

      const flat = listDirectory({ path: ".", rootDir: dir });
      expect(flat.entries.map((e) => e.name)).toEqual(["app.ts"]);

      const recursive = listDirectory({ path: ".", rootDir: dir, recursive: true });
      expect(recursive.entries.map((e) => e.name)).toEqual(["app.ts"]);
    }),
  );

  test(
    "includes file size for files",
    withTempDir((dir) => {
      const content = "hello world";
      writeFileSync(join(dir, "sized.txt"), content);

      const result = listDirectory({ path: ".", rootDir: dir });
      const entry = result.entries[0]!;

      expect(entry.size).toBe(Buffer.byteLength(content));
    }),
  );

  test(
    "returns truncated=false for normal case",
    withTempDir((dir) => {
      for (let i = 0; i < 10; i++) {
        writeFileSync(join(dir, `file${i}.ts`), `const x = ${i};`);
      }

      const result = listDirectory({ path: ".", rootDir: dir, recursive: true });

      expect(result.truncated).toBe(false);
      expect(result.entries).toHaveLength(10);
    }),
  );
});
