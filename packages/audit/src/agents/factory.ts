import type { AgentDefinition, AgentResult, FileContent, Finding } from "./types";

/**
 * Creates a response parser for an agent that extracts JSON from raw LLM output.
 */
export function parseAgentResponse(
  agentName: string,
  fallbackFile = "unknown",
): (raw: string) => AgentResult {
  return (raw: string): AgentResult => {
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON found in response");
      }

      const parsed = JSON.parse(jsonMatch[0]);

      if (typeof parsed.score !== "number" || parsed.score < 0 || parsed.score > 10) {
        throw new Error("Invalid score");
      }
      if (typeof parsed.summary !== "string") {
        throw new Error("Invalid summary");
      }
      if (!Array.isArray(parsed.findings)) {
        throw new Error("Invalid findings array");
      }

      const findings: Finding[] = parsed.findings.map((f: any) => ({
        severity: f.severity || "info",
        title: f.title || "Untitled issue",
        description: f.description || "",
        file: f.file || fallbackFile,
        line: f.line,
        suggestion: f.suggestion,
      }));

      return {
        agent: agentName,
        score: parsed.score,
        findings,
        summary: parsed.summary,
        durationMs: 0, // Will be set by orchestrator
      };
    } catch (error) {
      console.warn(`Failed to parse JSON from ${agentName} agent: ${String(error)}`);

      return {
        agent: agentName,
        score: 5.0,
        findings: [
          {
            severity: "warning",
            title: "Agent response parsing failed",
            description: `Could not parse structured response from ${agentName} agent.`,
            file: fallbackFile,
          },
        ],
        summary: "Analysis completed but response format was invalid",
        durationMs: 0,
      };
    }
  };
}

function formatFiles(files: FileContent[]): string {
  return files
    .map((file) => {
      const lines = file.content.split("\n");
      const numberedLines = lines.map((line, index) => `${index + 1}→${line}`).join("\n");
      return `File: ${file.relativePath}\nLanguage: ${file.language}\n\n${numberedLines}`;
    })
    .join("\n\n---\n\n");
}

/**
 * Creates a user prompt builder that formats files for analysis.
 */
export function createUserPrompt(
  topic: string,
  opts?: {
    fileFilter?: (file: FileContent) => boolean;
    emptyMessage?: string;
  },
): (files: FileContent[]) => string {
  return (files: FileContent[]): string => {
    const filtered = opts?.fileFilter ? files.filter(opts.fileFilter) : files;

    if (filtered.length === 0 && opts?.emptyMessage) {
      return opts.emptyMessage;
    }

    const fileContents = formatFiles(filtered);
    return `Analyze the following code for ${topic}:\n\n${fileContents}\n\nReturn your analysis as JSON.`;
  };
}

export interface AgentConfig {
  name: string;
  weight: number;
  systemPrompt: string;
  topic: string;
  fileFilter?: (file: FileContent) => boolean;
  emptyMessage?: string;
  fallbackFile?: string;
  /** Override the default prompt builder entirely. */
  customPromptBuilder?: (files: FileContent[]) => string;
}

/**
 * Creates a complete AgentDefinition from a config object.
 */
export function createAgent(config: AgentConfig): AgentDefinition {
  const userPromptTemplate = config.customPromptBuilder
    ? config.customPromptBuilder
    : createUserPrompt(config.topic, {
        fileFilter: config.fileFilter,
        emptyMessage: config.emptyMessage,
      });

  return {
    name: config.name,
    weight: config.weight,
    systemPrompt: config.systemPrompt,
    userPromptTemplate,
    parseResponse: parseAgentResponse(config.name, config.fallbackFile),
  };
}
