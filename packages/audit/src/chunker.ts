import type { FileContent } from "./agents/types";

export interface Chunk {
  files: FileContent[];
  estimatedTokens: number;
}

const CHARS_PER_TOKEN = 4;
const SAFETY_MARGIN = 0.9; // Use 90% of max to leave room for system prompts

/**
 * Estimate token count for a string using ~4 chars per token approximation
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Estimate tokens for a file (including metadata)
 */
function estimateFileTokens(file: FileContent): number {
  // Include tokens for path, language, and content
  const metadata = `File: ${file.relativePath}\nLanguage: ${file.language}\n\n`;
  return estimateTokens(metadata + file.content);
}

/**
 * Truncate file content if it exceeds the budget
 */
function truncateFile(file: FileContent, maxTokens: number): FileContent {
  const fileTokens = estimateFileTokens(file);

  if (fileTokens <= maxTokens) {
    return file;
  }

  // Calculate how much content we can keep
  const metadata = `File: ${file.relativePath}\nLanguage: ${file.language}\n\n`;
  const metadataTokens = estimateTokens(metadata);
  const availableTokens = maxTokens - metadataTokens - estimateTokens("\n\n[... truncated ...]");

  const maxChars = availableTokens * CHARS_PER_TOKEN;
  const truncatedContent = file.content.substring(0, maxChars) + "\n\n[... truncated ...]";

  console.warn(
    `Warning: File ${file.relativePath} exceeds token budget (${fileTokens} tokens). Truncating to ${maxTokens} tokens.`,
  );

  return {
    ...file,
    content: truncatedContent,
  };
}

/**
 * Group files into chunks based on token budget
 * Each chunk stays within maxTokensPerChunk limit
 */
export function createChunks(files: FileContent[], maxTokensPerChunk: number): Chunk[] {
  if (files.length === 0) {
    return [];
  }

  const effectiveMax = Math.floor(maxTokensPerChunk * SAFETY_MARGIN);
  const chunks: Chunk[] = [];
  let currentChunk: FileContent[] = [];
  let currentTokens = 0;

  for (const file of files) {
    let processedFile = file;
    let fileTokens = estimateFileTokens(file);

    // If a single file exceeds the budget, truncate it and put it in its own chunk
    if (fileTokens > effectiveMax) {
      // Save current chunk if it has files
      if (currentChunk.length > 0) {
        chunks.push({
          files: currentChunk,
          estimatedTokens: currentTokens,
        });
        currentChunk = [];
        currentTokens = 0;
      }

      // Truncate and create a dedicated chunk for this large file
      processedFile = truncateFile(file, effectiveMax);
      fileTokens = estimateFileTokens(processedFile);

      chunks.push({
        files: [processedFile],
        estimatedTokens: fileTokens,
      });

      continue;
    }

    // Check if adding this file would exceed the budget
    if (currentTokens + fileTokens > effectiveMax && currentChunk.length > 0) {
      // Save current chunk and start a new one
      chunks.push({
        files: currentChunk,
        estimatedTokens: currentTokens,
      });
      currentChunk = [];
      currentTokens = 0;
    }

    // Add file to current chunk
    currentChunk.push(processedFile);
    currentTokens += fileTokens;
  }

  // Add remaining files as final chunk
  if (currentChunk.length > 0) {
    chunks.push({
      files: currentChunk,
      estimatedTokens: currentTokens,
    });
  }

  return chunks;
}

/**
 * Format chunk summary for logging
 */
export function formatChunkSummary(chunks: Chunk[]): string {
  const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.files.length, 0);
  const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);

  const lines = [
    `Created ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}:`,
    `  Total files: ${totalFiles}`,
    `  Estimated tokens: ${totalTokens.toLocaleString()}`,
    "",
  ];

  chunks.forEach((chunk, index) => {
    lines.push(
      `  Chunk ${index + 1}: ${chunk.files.length} file${chunk.files.length === 1 ? "" : "s"}, ~${chunk.estimatedTokens.toLocaleString()} tokens`,
    );
  });

  return lines.join("\n");
}
