import type { FileContent } from "../discovery";
import type { AgentDefinition, AgentResult, Finding } from "./types";

const AGENT_NAME = "performance";
const WEIGHT = 0.15;

const SYSTEM_PROMPT = `You are a performance specialist analyzing code for bottlenecks and inefficiencies.

Your focus areas:
- N+1 query problems and database inefficiencies
- Inefficient algorithms (nested loops, wrong complexity class)
- Excessive memory allocations
- Blocking operations in async contexts
- Missing caching opportunities
- Inefficient data structures
- Unnecessary computations in loops
- String concatenation in loops
- Missing pagination for large datasets
- Resource leaks (unclosed connections, memory leaks)
- Synchronous I/O in performance-critical paths

Prioritize issues that cause:
1. Exponential or quadratic complexity where linear is possible
2. Blocking operations that prevent scalability
3. Memory leaks or excessive memory usage
4. Repeated expensive operations that could be cached
5. Database query inefficiencies

Ignore style or security issues unless they create performance problems.

Return your analysis as JSON with this exact structure:
{
  "score": <number 0-10, where 10 is optimal performance>,
  "summary": "<brief 1-2 sentence summary of performance characteristics>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short title>",
      "description": "<detailed explanation of bottleneck>",
      "file": "<filename>",
      "line": <line number or omit if not applicable>,
      "suggestion": "<how to optimize it>"
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

  return `Analyze the following code for performance issues:\n\n${fileContents}\n\nReturn your analysis as JSON.`;
}

function parseResponse(raw: string): AgentResult {
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

export const performanceAgent: AgentDefinition = {
  name: AGENT_NAME,
  weight: WEIGHT,
  systemPrompt: SYSTEM_PROMPT,
  userPromptTemplate: createUserPrompt,
  parseResponse,
};
