import type { FileContent } from "@code-auditor/types";

export type Severity = "critical" | "warning" | "info";

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
  score: number; // 0-10
  findings: Finding[];
  summary: string;
  durationMs: number;
}

export interface AgentDefinition {
  name: string;
  weight: number; // for weighted average (sum = 1.0)
  systemPrompt: string;
  userPromptTemplate: (files: FileContent[]) => string;
  parseResponse: (raw: string) => AgentResult;
}
