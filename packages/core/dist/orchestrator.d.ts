import type { FileContent } from "@code-auditor/types";
import type { AgentResult } from "./agents/types";
export interface OrchestratorOptions {
    model: string;
    maxTokens?: number;
}
/**
 * Progress event types emitted during audit execution
 */
export type ProgressEvent = {
    type: 'started';
    agentCount: number;
} | {
    type: 'agent-started';
    agent: string;
} | {
    type: 'agent-completed';
    agent: string;
    score: number;
    duration: number;
} | {
    type: 'completed';
    totalDuration: number;
};
/**
 * Run all agents in parallel on the provided files
 */
export declare function runAudit(files: FileContent[], options: OrchestratorOptions, onProgress?: (event: ProgressEvent) => void): Promise<AgentResult[]>;
/**
 * Calculate weighted average score across all agents
 */
export declare function calculateOverallScore(results: AgentResult[]): number;
//# sourceMappingURL=orchestrator.d.ts.map