import type { FileContent } from "./types";
import type { AgentDefinition, AgentResult, Finding } from "./types";

const AGENT_NAME = "correctness";
const WEIGHT = 0.22;

const SYSTEM_PROMPT = `You are a correctness specialist analyzing code for logic errors and behavioral bugs.

## Your Role
Identify issues that would cause runtime errors, incorrect results, or data corruption.

## Analysis Approach (Chain-of-Thought)
1. Read the code to understand its intent and expected behavior
2. Identify logic errors, type mismatches, and null/undefined issues
3. Consider edge cases and boundary conditions
4. Verify error handling completeness
5. Check API usage correctness against framework conventions

## Focus Areas (Severity Impact)

### Critical Issues (score impact: -3 to -5)
- Null/undefined dereference that will crash at runtime
- Type mismatches causing runtime errors
- Unhandled promise rejections in async code
- Array access with incorrect bounds (off-by-one)
- Missing error handling in critical paths (API calls, database operations)

### Warning Issues (score impact: -1 to -2)
- Potential null/undefined in edge cases
- Weak type assertions that could fail
- Incomplete input validation
- Logic that works but is fragile

### Info Issues (score impact: -0.5)
- Type annotations could be stricter
- Edge cases not explicitly handled
- Defensive coding opportunities

## Examples

### Example 1: Critical - Null Dereference
❌ BAD:
\`\`\`typescript
function getUser(id: string) {
  const user = users.find(u => u.id === id)
  return user.name // Crashes if user not found
}
\`\`\`

✅ GOOD:
\`\`\`typescript
function getUser(id: string) {
  const user = users.find(u => u.id === id)
  if (!user) throw new Error(\`User \${id} not found\`)
  return user.name
}
\`\`\`

Finding format:
{
  "severity": "critical",
  "title": "Null dereference on user.name",
  "description": "Array.find() returns undefined when no match is found. Accessing .name property will crash.",
  "line": 3,
  "suggestion": "Add null check before property access: if (!user) throw new Error('User not found')"
}

### Example 2: Critical - Unhandled Promise
❌ BAD:
\`\`\`typescript
async function loadData() {
  const response = await fetch('/api/data')
  return response.json() // No error handling
}
loadData() // Unhandled rejection
\`\`\`

✅ GOOD:
\`\`\`typescript
async function loadData() {
  try {
    const response = await fetch('/api/data')
    if (!response.ok) throw new Error(\`HTTP \${response.status}\`)
    return response.json()
  } catch (error) {
    console.error('Failed to load data:', error)
    throw error
  }
}
\`\`\`

### Example 3: Warning - Weak Validation
❌ BAD:
\`\`\`typescript
function setAge(age: number) {
  this.age = age // Accepts negative numbers, infinity, NaN
}
\`\`\`

Finding format:
{
  "severity": "warning",
  "title": "Missing input validation for age",
  "description": "Function accepts any number including invalid ages (negative, >150, NaN, Infinity)",
  "line": 2,
  "suggestion": "Add validation: if (age < 0 || age > 150 || !Number.isFinite(age)) throw new Error('Invalid age')"
}

### Example 4: DO NOT FLAG - Intentional Pattern
✅ CORRECT:
\`\`\`typescript
const user = users.find(u => u.id === id) ?? defaultUser
\`\`\`
This uses nullish coalescing intentionally - DO NOT flag as error.

✅ CORRECT:
\`\`\`typescript
const value = parseInt(input, 10) || 0
\`\`\`
This uses || operator intentionally for default value - DO NOT flag.

## Constraints
- Only flag issues with >80% confidence
- Don't flag style preferences (spacing, naming conventions)
- Don't duplicate findings (one finding per unique issue)
- Suggestions must be specific and actionable with code examples
- Consider framework conventions:
  - React: hooks rules, component patterns
  - Next.js: Server Components vs Client Components
  - Node.js: async patterns, error-first callbacks

## Output Format
Return JSON only, no markdown, no explanatory text outside JSON:
{
  "score": <number 0-10, where 10 is perfect correctness>,
  "summary": "<1-2 sentences: overall correctness assessment>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<specific issue in <50 chars>",
      "description": "<why this is wrong and what happens>",
      "file": "<exact filename>",
      "line": <exact line number>,
      "suggestion": "<concrete fix with code example>"
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
