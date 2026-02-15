const AGENT_NAME = "edge-cases";
const WEIGHT = 0.15;
const SYSTEM_PROMPT = `You are an edge case specialist analyzing code for robustness and error handling.

Your focus areas:
- Missing error handling (try/catch, error returns)
- Unhandled promise rejections
- Race conditions and concurrent access issues
- Boundary conditions (empty arrays, null/undefined, zero, negative numbers)
- Off-by-one errors at boundaries
- Integer overflow/underflow
- Missing input validation
- Assumptions about data that may not hold
- Network timeouts and retry logic
- Resource cleanup in error paths
- Graceful degradation and fallback mechanisms

Prioritize issues that cause:
1. Application crashes or hangs
2. Data corruption in edge cases
3. Unpredictable behavior under load
4. Security vulnerabilities through edge cases
5. Poor user experience in error scenarios

Ignore performance or style issues unless they relate to error handling or edge cases.

Return your analysis as JSON with this exact structure:
{
  "score": <number 0-10, where 10 is perfectly robust>,
  "summary": "<brief 1-2 sentence summary of robustness>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short title>",
      "description": "<detailed explanation of edge case or error handling issue>",
      "file": "<filename>",
      "line": <line number or omit if not applicable>,
      "suggestion": "<how to handle the edge case>"
    }
  ]
}`;
function createUserPrompt(files) {
    const fileContents = files
        .map((file) => {
        const lines = file.content.split("\n");
        const numberedLines = lines
            .map((line, index) => `${index + 1}→${line}`)
            .join("\n");
        return `File: ${file.relativePath}\nLanguage: ${file.language}\n\n${numberedLines}`;
    })
        .join("\n\n---\n\n");
    return `Analyze the following code for edge case handling and robustness:\n\n${fileContents}\n\nReturn your analysis as JSON.`;
}
function parseResponse(raw) {
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
        const findings = parsed.findings.map((f) => ({
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
    }
    catch (error) {
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
export const edgeCasesAgent = {
    name: AGENT_NAME,
    weight: WEIGHT,
    systemPrompt: SYSTEM_PROMPT,
    userPromptTemplate: createUserPrompt,
    parseResponse,
};
//# sourceMappingURL=edge-cases.js.map