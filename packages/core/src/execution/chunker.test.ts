import { describe, expect, it } from "bun:test";

import type { FileContent } from "./chunker.js";
import { createChunks, estimateTokens, formatChunkSummary } from "./chunker.js";

const createMockFile = (size: number, name: string = "test.ts"): FileContent => ({
  path: `/test/${name}`,
  relativePath: name,
  content: "x".repeat(size * 4), // size * 4 chars = size tokens
  language: "typescript",
  size: 100,
});

describe("estimateTokens", () => {
  it("estimates tokens using ~4 chars per token", () => {
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });

  it("rounds up for partial tokens", () => {
    expect(estimateTokens("x".repeat(401))).toBe(101);
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});

describe("createChunks", () => {
  it("creates single chunk when files fit under limit", () => {
    const files = [createMockFile(100, "small1.ts"), createMockFile(100, "small2.ts")];
    const chunks = createChunks(files, 10000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toHaveLength(2);
  });

  it("splits into multiple chunks when files exceed limit", () => {
    const files = [createMockFile(5000, "large1.ts"), createMockFile(5000, "large2.ts")];
    const chunks = createChunks(files, 8000);

    expect(chunks.length).toBeGreaterThan(1);
  });

  it("truncates single file that exceeds chunk limit", () => {
    const files = [createMockFile(15000, "huge.ts")];
    const chunks = createChunks(files, 10000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].files[0].content).toContain("truncated");
  });

  it("preserves all files across chunks", () => {
    const files = [
      createMockFile(3000, "file1.ts"),
      createMockFile(3000, "file2.ts"),
      createMockFile(3000, "file3.ts"),
    ];
    const chunks = createChunks(files, 6000);

    const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.files.length, 0);
    expect(totalFiles).toBe(3);
  });

  it("does not split individual files across chunks", () => {
    const files = [
      createMockFile(2000, "file1.ts"),
      createMockFile(2000, "file2.ts"),
      createMockFile(2000, "file3.ts"),
    ];
    const chunks = createChunks(files, 5000);

    const appearances = new Map<string, number>();
    for (const chunk of chunks) {
      for (const file of chunk.files) {
        appearances.set(file.relativePath, (appearances.get(file.relativePath) ?? 0) + 1);
      }
    }
    for (const count of appearances.values()) {
      expect(count).toBe(1);
    }
  });

  it("returns empty array for empty input", () => {
    expect(createChunks([], 10000)).toHaveLength(0);
  });
});

describe("formatChunkSummary", () => {
  it("formats single chunk summary", () => {
    const chunks = createChunks([createMockFile(100, "file.ts")], 10000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toContain("1 chunk");
    expect(summary).toContain("Total files: 1");
  });

  it("includes token estimates", () => {
    const chunks = createChunks([createMockFile(1000, "file.ts")], 10000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toMatch(/Estimated tokens: [\d,]+/);
  });

  it("handles empty chunks array", () => {
    const summary = formatChunkSummary([]);

    expect(summary).toContain("0 chunk");
    expect(summary).toContain("Total files: 0");
  });
});
