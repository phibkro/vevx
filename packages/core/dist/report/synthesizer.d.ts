import type { AgentResult } from "../agents/types";
export interface AuditReport {
    target: string;
    overallScore: number;
    agentResults: AgentResult[];
    criticalCount: number;
    warningCount: number;
    infoCount: number;
    topRecommendations: string[];
    timestamp: string;
}
/**
 * Synthesize agent results into a comprehensive audit report
 */
export declare function synthesizeReport(target: string, agentResults: AgentResult[]): AuditReport;
//# sourceMappingURL=synthesizer.d.ts.map