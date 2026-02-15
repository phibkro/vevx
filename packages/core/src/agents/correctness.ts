import type { FileContent } from "@code-auditor/types";
import type { AgentDefinition, AgentResult, Finding } from "./types";

const AGENT_NAME = "correctness";
const WEIGHT = 0.25;

const SYSTEM_PROMPT = `You are a correctness specialist analyzing code for logic errors, type safety issues, and behavioral bugs.

Your focus areas:
- Logic errors and incorrect algorithms
- Type safety violations and type mismatches
- Null/undefined handling issues
- Off-by-one errors and boundary conditions
- Incorrect API usage and contract violations
- Return value mismatches
- Incorrect assumptions about data structures
- Edge case handling in business logic

Prioritize issues that would cause:
1. Runtime errors or crashes
2. Incorrect computation results
3. Data corruption or loss
4. Type system violations

Ignore style, performance, or maintainability unless they directly impact correctness.

Return your analysis as JSON with this exact structure:
{
  "score": <number 0-10, where 10 is perfect correctness>,
  "summary": "<brief 1-2 sentence summary of correctness>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short title>",
      "description": "<detailed explanation>",
      "file": "<filename>",
      "line": <line number or omit if not applicable>,
      "suggestion": "<how to fix it>"
    }
  ]
}`;

function createUserPrompt(files: FileContent[]): string {
  const fileContents = files
    .map((file) => {
      const lines = file.content.split("\n");
      const numberedLines = lines
        .map((line, index) => `${index + 1}→${line}`)
        .join("\n");
      return `File: ${file.relativePath}\nLanguage: ${file.language}\n\n${numberedLines}`;
    })
    .join("\n\n---\n\n");

  return `Analyze the following code for correctness issues:\n\n${fileContents}\n\nReturn your analysis as JSON.`;
}

function parseResponse(raw: string): AgentResult {
  const startTime = Date.now();

  try {
    // Try to extract JSON from response
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate structure
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
      file: f.file || "unknown",
      line: f.line,
      suggestion: f.suggestion,
    }));

    return {
      agent: AGENT_NAME,
      score: parsed.score,
      findings,
      summary: parsed.summary,
      durationMs: 0, // Will be set by orchestrator
    };
  } catch (error) {
    // Fallback: parse as plaintext
    console.warn(`Failed to parse JSON from ${AGENT_NAME} agent: ${error}`);

    return {
      agent: AGENT_NAME,
      score: 5.0, // Neutral score when parsing fails
      findings: [
        {
          severity: "warning",
          title: "Agent response parsing failed",
          description: `Could not parse structured response: ${error}. Raw response: ${raw.substring(0, 200)}...`,
          file: "unknown",
        },
      ],
      summary: "Analysis completed but response format was invalid",
      durationMs: 0,
    };
  }
}

export const correctnessAgent: AgentDefinition = {
  name: AGENT_NAME,
  weight: WEIGHT,
  systemPrompt: SYSTEM_PROMPT,
  userPromptTemplate: createUserPrompt,
  parseResponse,
};
