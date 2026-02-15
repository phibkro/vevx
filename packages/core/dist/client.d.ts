export interface ApiCallOptions {
    model: string;
    maxTokens?: number;
}
/**
 * Call Claude API with retry logic and rate limiting
 */
export declare function callClaude(systemPrompt: string, userPrompt: string, options: ApiCallOptions): Promise<string>;
/**
 * Simple test function to verify API connectivity
 * Can be run with: bun run src/client.ts
 */
export declare function testConnection(model?: string): Promise<void>;
//# sourceMappingURL=client.d.ts.map