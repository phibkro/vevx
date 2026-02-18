import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";

import { discoverFiles } from "../discovery";

/** Each test gets its own temp dir to avoid races under --concurrent */
function withTempDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join("/tmp/claude", "audit-discover-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

describe("discoverFiles", () => {
  it(
    "discovers a single TypeScript file",
    withTempDir(async (dir) => {
      const filePath = join(dir, "index.ts");
      writeFileSync(filePath, "const x = 1;");

      const files = await discoverFiles(filePath);

      expect(files).toHaveLength(1);
      expect(files[0].language).toBe("typescript");
      expect(files[0].content).toBe("const x = 1;");
      expect(files[0].size).toBeGreaterThan(0);
    }),
  );

  it(
    "discovers a single JavaScript file",
    withTempDir(async (dir) => {
      const filePath = join(dir, "app.js");
      writeFileSync(filePath, "const y = 2;");

      const files = await discoverFiles(filePath);

      expect(files).toHaveLength(1);
      expect(files[0].language).toBe("javascript");
    }),
  );

  it(
    "discovers a Python file",
    withTempDir(async (dir) => {
      const filePath = join(dir, "script.py");
      writeFileSync(filePath, "x = 1");

      const files = await discoverFiles(filePath);

      expect(files).toHaveLength(1);
      expect(files[0].language).toBe("python");
    }),
  );

  it(
    "throws for unsupported file extension",
    withTempDir(async (dir) => {
      const filePath = join(dir, "readme.md");
      writeFileSync(filePath, "# Hello");

      try {
        await discoverFiles(filePath);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("Unsupported file type");
      }
    }),
  );

  it(
    "throws for nonexistent path",
    withTempDir(async (dir) => {
      try {
        await discoverFiles(join(dir, "nonexistent.ts"));
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("Path not found");
      }
    }),
  );

  it(
    "discovers all code files in a directory",
    withTempDir(async (dir) => {
      writeFileSync(join(dir, "a.ts"), "const a = 1;");
      writeFileSync(join(dir, "b.js"), "const b = 2;");
      writeFileSync(join(dir, "c.py"), "c = 3");
      writeFileSync(join(dir, "readme.md"), "# Ignored");

      const files = await discoverFiles(dir);

      expect(files).toHaveLength(3);
      const languages = files.map((f) => f.language).sort();
      expect(languages).toEqual(["javascript", "python", "typescript"]);
    }),
  );

  it(
    "discovers files in subdirectories",
    withTempDir(async (dir) => {
      mkdirSync(join(dir, "src"), { recursive: true });
      writeFileSync(join(dir, "src", "index.ts"), "export {};");
      writeFileSync(join(dir, "src", "util.ts"), "export {};");

      const files = await discoverFiles(dir);

      expect(files).toHaveLength(2);
    }),
  );

  it(
    "skips node_modules by default",
    withTempDir(async (dir) => {
      mkdirSync(join(dir, "node_modules", "pkg"), { recursive: true });
      writeFileSync(join(dir, "node_modules", "pkg", "index.js"), "module.exports = {};");
      writeFileSync(join(dir, "app.ts"), "import pkg from 'pkg';");

      const files = await discoverFiles(dir);

      expect(files).toHaveLength(1);
      expect(files[0].relativePath).toContain("app.ts");
    }),
  );

  it(
    "respects .gitignore patterns",
    withTempDir(async (dir) => {
      writeFileSync(join(dir, ".gitignore"), "generated/\n*.gen.ts");
      mkdirSync(join(dir, "generated"), { recursive: true });
      writeFileSync(join(dir, "generated", "types.ts"), "// generated");
      writeFileSync(join(dir, "schema.gen.ts"), "// generated");
      writeFileSync(join(dir, "app.ts"), "// real code");

      const files = await discoverFiles(dir);

      expect(files).toHaveLength(1);
      expect(files[0].content).toBe("// real code");
    }),
  );

  it(
    "throws when directory contains no supported code files",
    withTempDir(async (dir) => {
      writeFileSync(join(dir, "readme.md"), "# Hello");
      writeFileSync(join(dir, "data.json"), "{}");

      try {
        await discoverFiles(dir);
        expect.unreachable("Should have thrown");
      } catch (e) {
        expect((e as Error).message).toContain("No supported code files found");
      }
    }),
  );

  it(
    "returns correct file size",
    withTempDir(async (dir) => {
      const content = "x".repeat(100);
      const filePath = join(dir, "sized.ts");
      writeFileSync(filePath, content);

      const files = await discoverFiles(filePath);

      expect(files[0].size).toBe(100);
    }),
  );
});
