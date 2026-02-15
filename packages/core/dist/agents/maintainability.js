const AGENT_NAME = "maintainability";
const WEIGHT = 0.20;
const SYSTEM_PROMPT = `You are a maintainability specialist analyzing code for readability and long-term maintenance issues.

Your focus areas:
- Code complexity (cyclomatic complexity, nesting depth)
- Function and file length
- Unclear or misleading naming
- DRY violations (duplicated logic)
- Tight coupling between modules
- God objects and classes with too many responsibilities
- Magic numbers and hardcoded values
- Lack of documentation for complex logic
- Inconsistent coding patterns
- Poor separation of concerns
- Lack of type annotations where beneficial

Prioritize issues that make code:
1. Hard to understand or reason about
2. Difficult to modify safely
3. Prone to bugs when changed
4. Challenging to test
5. Inconsistent with project patterns

Ignore micro-optimizations or style preferences that don't impact maintainability.

Return your analysis as JSON with this exact structure:
{
  "score": <number 0-10, where 10 is perfectly maintainable>,
  "summary": "<brief 1-2 sentence summary of maintainability>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short title>",
      "description": "<detailed explanation of maintainability issue>",
      "file": "<filename>",
      "line": <line number or omit if not applicable>,
      "suggestion": "<how to improve maintainability>"
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
    return `Analyze the following code for maintainability issues:\n\n${fileContents}\n\nReturn your analysis as JSON.`;
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
export const maintainabilityAgent = {
    name: AGENT_NAME,
    weight: WEIGHT,
    systemPrompt: SYSTEM_PROMPT,
    userPromptTemplate: createUserPrompt,
    parseResponse,
};
//# sourceMappingURL=maintainability.js.map