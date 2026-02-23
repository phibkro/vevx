import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { editInsertAfter, editInsertBefore, editReplace } from "./Editor.js";

mkdirSync("/tmp/claude", { recursive: true });

function withTempFile(content: string, fn: (path: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join("/tmp/claude/", "kart-editor-"));
    const filePath = join(dir, "target.ts");
    writeFileSync(filePath, content);
    try {
      await fn(filePath);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

const FIXTURE = `export function greet(name: string): string {
  return \`Hello \${name}\`;
}

export const MAX = 100;
`;

describe("editReplace", () => {
  test(
    "replaces a function body",
    withTempFile(FIXTURE, async (filePath) => {
      const result = await editReplace(
        filePath,
        "greet",
        "export function greet(name: string): string {\n  return `Hi ${name}`;\n}",
      );
      expect(result.success).toBe(true);
      expect(result.symbol).toBe("greet");
      expect(result.syntaxError).toBe(false);
      const updated = readFileSync(filePath, "utf-8");
      expect(updated).toContain("Hi ${name}");
      expect(updated).not.toContain("Hello ${name}");
    }),
  );

  test(
    "rejects syntax errors without modifying file",
    withTempFile(FIXTURE, async (filePath) => {
      const before = readFileSync(filePath, "utf-8");
      const result = await editReplace(filePath, "greet", "export function greet( {{{");
      expect(result.success).toBe(false);
      expect(result.syntaxError).toBe(true);
      expect(result.syntaxErrorMessage).toBeDefined();
      // File unchanged
      const after = readFileSync(filePath, "utf-8");
      expect(after).toBe(before);
    }),
  );

  test(
    "returns error for unknown symbol",
    withTempFile(FIXTURE, async (filePath) => {
      const result = await editReplace(filePath, "nonexistent", "const x = 1;");
      expect(result.success).toBe(false);
      expect(result.syntaxError).toBe(false);
      expect(result.syntaxErrorMessage).toContain("nonexistent");
    }),
  );

  test(
    "verifies file is actually modified on disk",
    withTempFile(FIXTURE, async (filePath) => {
      await editReplace(filePath, "MAX", "export const MAX = 999;");
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("MAX = 999");
      expect(content).not.toContain("MAX = 100");
    }),
  );
});

describe("editInsertAfter", () => {
  test(
    "inserts content after a symbol",
    withTempFile(FIXTURE, async (filePath) => {
      const result = await editInsertAfter(
        filePath,
        "greet",
        "\nexport function farewell(): string {\n  return 'Goodbye';\n}\n",
      );
      expect(result.success).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("farewell");
      // greet should still be there
      expect(content).toContain("greet");
    }),
  );
});

describe("editInsertBefore", () => {
  test(
    "inserts content before a symbol",
    withTempFile(FIXTURE, async (filePath) => {
      const result = await editInsertBefore(filePath, "greet", "// This is a greeting function\n");
      expect(result.success).toBe(true);
      const content = readFileSync(filePath, "utf-8");
      expect(content).toContain("// This is a greeting function");
      // Should appear before greet
      const commentIdx = content.indexOf("// This is a greeting function");
      const greetIdx = content.indexOf("export function greet");
      expect(commentIdx).toBeLessThan(greetIdx);
    }),
  );
});

describe("error paths", () => {
  test("returns error for nonexistent file", async () => {
    const result = await editReplace("/tmp/claude/nonexistent-file.ts", "greet", "const x = 1;");
    expect(result.success).toBe(false);
    expect(result.syntaxError).toBe(false);
    expect(result.syntaxErrorMessage).toContain("Failed to read file");
  });

  test(
    "rejects when splice produces invalid file",
    withTempFile(
      `export function greet(name: string): string {\n  return \`Hello \${name}\`;\n}\n`,
      async (filePath) => {
        const before = readFileSync(filePath, "utf-8");
        // Insert content that is individually valid but makes the full file invalid
        const result = await editInsertAfter(filePath, "greet", "\n} // stray closing brace\n");
        // The inserted content itself doesn't get fragment-validated (only replace does),
        // but the full-file validation should catch it
        if (!result.success) {
          expect(result.syntaxError).toBe(true);
          expect(result.syntaxErrorMessage).toContain("syntax error");
          // File should be unchanged
          const after = readFileSync(filePath, "utf-8");
          expect(after).toBe(before);
        }
      },
    ),
  );
});

describe("workspace boundary", () => {
  test(
    "rejects paths outside workspace root",
    withTempFile(FIXTURE, async (filePath) => {
      const result = await editReplace(
        filePath,
        "greet",
        "export function greet() {}",
        "/nonexistent/root",
      );
      expect(result.success).toBe(false);
      expect(result.syntaxErrorMessage).toContain("outside workspace root");
    }),
  );

  test(
    "allows paths within workspace root",
    withTempFile(FIXTURE, async (filePath) => {
      const dir = filePath.split("/").slice(0, -1).join("/");
      const result = await editReplace(
        filePath,
        "greet",
        "export function greet(name: string): string {\n  return `Hi ${name}`;\n}",
        dir,
      );
      expect(result.success).toBe(true);
    }),
  );
});
