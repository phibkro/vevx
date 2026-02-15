export type Severity = "critical" | "warning" | "info";
export interface FileContent {
    path: string;
    relativePath: string;
    content: string;
    language: string;
}
export interface Finding {
    severity: Severity;
    title: string;
    description: string;
    file: string;
    line?: number;
    suggestion?: string;
}
export interface AgentResult {
    agent: string;
    score: number;
    findings: Finding[];
    summary: string;
    durationMs: number;
}
export interface AgentDefinition {
    name: string;
    weight: number;
    systemPrompt: string;
    userPromptTemplate: (files: FileContent[]) => string;
    parseResponse: (raw: string) => AgentResult;
}
//# sourceMappingURL=agent.d.ts.map