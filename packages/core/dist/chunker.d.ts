import type { FileContent } from "@code-auditor/types";
export interface Chunk {
    files: FileContent[];
    estimatedTokens: number;
}
/**
 * Estimate token count for a string using ~4 chars per token approximation
 */
export declare function estimateTokens(text: string): number;
/**
 * Group files into chunks based on token budget
 * Each chunk stays within maxTokensPerChunk limit
 */
export declare function createChunks(files: FileContent[], maxTokensPerChunk: number): Chunk[];
/**
 * Format chunk summary for logging
 */
export declare function formatChunkSummary(chunks: Chunk[]): string;
//# sourceMappingURL=chunker.d.ts.map