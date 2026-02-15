import type { FileContent } from "@code-auditor/types";
import type { AgentResult } from "./agents/types";
interface OrchestratorOptions {
    model: string;
    maxTokens?: number;
}
/**
 * Run all agents in parallel on the provided files
 */
export declare function runAudit(files: FileContent[], options: OrchestratorOptions): Promise<AgentResult[]>;
/**
 * Calculate weighted average score across all agents
 */
export declare function calculateOverallScore(results: AgentResult[]): number;
export {};
//# sourceMappingURL=orchestrator.d.ts.map