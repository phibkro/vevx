import type { FileContent } from "../agents/types";
import { createChunks, estimateTokens, formatChunkSummary } from "../chunker";

describe("Token Estimation", () => {
  it("estimates tokens using ~4 chars per token", () => {
    const text = "x".repeat(400);
    const tokens = estimateTokens(text);
    expect(tokens).toBe(100); // 400 / 4 = 100
  });

  it("rounds up for partial tokens", () => {
    const text = "x".repeat(401);
    const tokens = estimateTokens(text);
    expect(tokens).toBe(101); // ceil(401 / 4) = 101
  });

  it("handles empty string", () => {
    const tokens = estimateTokens("");
    expect(tokens).toBe(0);
  });

  it("handles single character", () => {
    const tokens = estimateTokens("x");
    expect(tokens).toBe(1); // ceil(1 / 4) = 1
  });
});

describe("File Chunking", () => {
  const createMockFile = (size: number, name: string = "test.ts"): FileContent => ({
    path: `/test/${name}`,
    relativePath: name,
    content: "x".repeat(size * 4), // size * 4 chars = size tokens
    language: "typescript",
  });

  it("creates single chunk when files fit under limit", () => {
    const files = [createMockFile(100, "small1.ts"), createMockFile(100, "small2.ts")];

    const chunks = createChunks(files, 10000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toHaveLength(2);
  });

  it("creates multiple chunks when files exceed limit", () => {
    const files = [createMockFile(5000, "large1.ts"), createMockFile(5000, "large2.ts")];

    // Max tokens per chunk: 8000
    // Each file is ~5000 tokens + metadata
    // Should split into 2 chunks
    const chunks = createChunks(files, 8000);

    expect(chunks.length).toBeGreaterThan(1);
  });

  it("applies safety margin (90% of max)", () => {
    const files = [createMockFile(1000, "file.ts")];

    // Max = 10000, safety margin = 90% = 9000 effective
    const chunks = createChunks(files, 10000);

    expect(chunks[0].estimatedTokens).toBeLessThan(10000);
    expect(chunks[0].estimatedTokens).toBeLessThanOrEqual(9000);
  });

  it("truncates single file that exceeds chunk limit", () => {
    const files = [
      createMockFile(15000, "huge.ts"), // File larger than chunk limit
    ];

    const chunks = createChunks(files, 10000);

    // Should create 1 chunk with truncated file
    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toHaveLength(1);
    expect(chunks[0].files[0].content).toContain("truncated");
  });

  it("splits files across multiple chunks correctly", () => {
    const files = [
      createMockFile(3000, "file1.ts"),
      createMockFile(3000, "file2.ts"),
      createMockFile(3000, "file3.ts"),
    ];

    // Each file ~3000 tokens, max chunk ~5400 (6000 * 0.9)
    // Should fit 1 file per chunk
    const chunks = createChunks(files, 6000);

    expect(chunks.length).toBeGreaterThanOrEqual(2);

    const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.files.length, 0);
    expect(totalFiles).toBe(3); // All files accounted for
  });

  it("handles empty files array", () => {
    const chunks = createChunks([], 10000);
    expect(chunks).toHaveLength(0);
  });

  it("handles single file under limit", () => {
    const files = [createMockFile(100, "tiny.ts")];
    const chunks = createChunks(files, 10000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toHaveLength(1);
    expect(chunks[0].files[0].relativePath).toBe("tiny.ts");
  });

  it("preserves file metadata", () => {
    const files = [
      {
        path: "/absolute/path/to/file.ts",
        relativePath: "src/file.ts",
        content: "const x = 1;",
        language: "typescript",
      },
    ];

    const chunks = createChunks(files, 10000);

    expect(chunks[0].files[0].path).toBe("/absolute/path/to/file.ts");
    expect(chunks[0].files[0].relativePath).toBe("src/file.ts");
    expect(chunks[0].files[0].language).toBe("typescript");
  });

  it("estimates chunk tokens accurately", () => {
    const files = [createMockFile(1000, "file1.ts"), createMockFile(2000, "file2.ts")];

    const chunks = createChunks(files, 50000);

    // Each file has metadata overhead (path, language, etc.)
    // Should be roughly 3000+ tokens
    expect(chunks[0].estimatedTokens).toBeGreaterThan(3000);
    expect(chunks[0].estimatedTokens).toBeLessThan(4000);
  });

  it("does not split individual files across chunks", () => {
    const files = [
      createMockFile(2000, "file1.ts"),
      createMockFile(2000, "file2.ts"),
      createMockFile(2000, "file3.ts"),
    ];

    const chunks = createChunks(files, 5000);

    // Verify no file appears in multiple chunks
    const fileAppearances = new Map<string, number>();

    chunks.forEach((chunk) => {
      chunk.files.forEach((file) => {
        const count = fileAppearances.get(file.relativePath) || 0;
        fileAppearances.set(file.relativePath, count + 1);
      });
    });

    fileAppearances.forEach((count, fileName) => {
      expect(count).toBe(1); // Each file appears exactly once
    });
  });

  it("handles mixed file sizes efficiently", () => {
    const files = [
      createMockFile(100, "tiny.ts"),
      createMockFile(5000, "large.ts"),
      createMockFile(200, "small.ts"),
      createMockFile(4000, "medium.ts"),
    ];

    const chunks = createChunks(files, 10000);

    expect(chunks.length).toBeGreaterThan(0);

    // All files should be included
    const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.files.length, 0);
    expect(totalFiles).toBe(4);
  });
});

describe("Chunk Summary Formatting", () => {
  const createMockFile = (size: number, name: string): FileContent => ({
    path: `/test/${name}`,
    relativePath: name,
    content: "x".repeat(size * 4),
    language: "typescript",
  });

  it("formats single chunk summary", () => {
    const files = [createMockFile(100, "file.ts")];
    const chunks = createChunks(files, 10000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toContain("1 chunk");
    expect(summary).toContain("1 file");
    expect(summary).toContain("Chunk 1");
  });

  it("formats multiple chunks summary", () => {
    const files = [createMockFile(5000, "large1.ts"), createMockFile(5000, "large2.ts")];
    const chunks = createChunks(files, 8000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toContain("chunks");
    expect(summary).toMatch(/Chunk \d+/);
  });

  it("includes total file count", () => {
    const files = [
      createMockFile(100, "file1.ts"),
      createMockFile(100, "file2.ts"),
      createMockFile(100, "file3.ts"),
    ];
    const chunks = createChunks(files, 10000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toContain("Total files: 3");
  });

  it("includes estimated token count", () => {
    const files = [createMockFile(1000, "file.ts")];
    const chunks = createChunks(files, 10000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toMatch(/Estimated tokens: [\d,]+/);
  });

  it("uses correct pluralization for single file", () => {
    const files = [createMockFile(100, "single.ts")];
    const chunks = createChunks(files, 10000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toContain("1 file,");
  });

  it("uses correct pluralization for multiple files", () => {
    const files = [createMockFile(100, "file1.ts"), createMockFile(100, "file2.ts")];
    const chunks = createChunks(files, 10000);
    const summary = formatChunkSummary(chunks);

    expect(summary).toContain("2 files,");
  });

  it("formats token counts with locale separators", () => {
    const files = [createMockFile(10000, "large.ts")];
    const chunks = createChunks(files, 50000);
    const summary = formatChunkSummary(chunks);

    // Should include comma separators for large numbers
    expect(summary).toMatch(/[\d,]+/);
  });

  it("handles empty chunks array", () => {
    const summary = formatChunkSummary([]);

    expect(summary).toContain("0 chunk");
    expect(summary).toContain("Total files: 0");
  });
});

describe("Edge Cases", () => {
  const createMockFile = (size: number, name: string): FileContent => ({
    path: `/test/${name}`,
    relativePath: name,
    content: "x".repeat(size * 4),
    language: "typescript",
  });

  it("handles very small chunk limit", () => {
    const files = [createMockFile(100, "file.ts")];

    // Unreasonably small limit
    const chunks = createChunks(files, 10);

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].files[0].content).toContain("truncated");
  });

  it("handles very large chunk limit", () => {
    const files = [createMockFile(1000, "file1.ts"), createMockFile(1000, "file2.ts")];

    // Very large limit - all files should fit
    const chunks = createChunks(files, 1000000);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].files).toHaveLength(2);
  });

  it("handles files with special characters in name", () => {
    const files: FileContent[] = [
      {
        path: "/test/file-with-dashes.ts",
        relativePath: "file-with-dashes.ts",
        content: "test",
        language: "typescript",
      },
      {
        path: "/test/file_with_underscores.ts",
        relativePath: "file_with_underscores.ts",
        content: "test",
        language: "typescript",
      },
    ];

    const chunks = createChunks(files, 10000);

    expect(chunks[0].files[0].relativePath).toBe("file-with-dashes.ts");
    expect(chunks[0].files[1].relativePath).toBe("file_with_underscores.ts");
  });

  it("handles files with different languages", () => {
    const files: FileContent[] = [
      {
        path: "/test/file.ts",
        relativePath: "file.ts",
        content: "typescript code",
        language: "typescript",
      },
      {
        path: "/test/file.py",
        relativePath: "file.py",
        content: "python code",
        language: "python",
      },
    ];

    const chunks = createChunks(files, 10000);

    expect(chunks[0].files[0].language).toBe("typescript");
    expect(chunks[0].files[1].language).toBe("python");
  });
});
