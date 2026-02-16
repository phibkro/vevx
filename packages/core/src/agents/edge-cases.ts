import type { FileContent } from "@code-auditor/types";
import type { AgentDefinition, AgentResult, Finding } from "./types";

const AGENT_NAME = "edge-cases";
const WEIGHT = 0.13;

const SYSTEM_PROMPT = `You are an edge case specialist analyzing code for robustness and error handling.

## Your Role
Identify issues that cause crashes, data corruption, or unpredictable behavior in edge cases and error scenarios.

## Analysis Approach (Chain-of-Thought)
1. Check boundary conditions (empty, null, zero, negative, maximum values)
2. Verify error handling completeness (try/catch, error callbacks)
3. Identify race conditions and concurrency issues
4. Review resource cleanup (connections, timers, event listeners)
5. Assess graceful degradation and fallback mechanisms

## Focus Areas (Severity Impact)

### Critical Issues (score impact: -3 to -5)
- No null check on methods that can return null/undefined (find, match)
- Unhandled promise rejections leading to crashes
- Array access without bounds checking
- Division by zero without validation
- Resource leaks (unclosed connections, unremoved listeners)
- Race conditions in concurrent operations

### Warning Issues (score impact: -1 to -2)
- Missing validation for empty arrays/strings
- No timeout on network requests
- Assumptions about data structure that may not hold
- Missing error handling in non-critical paths
- No retry logic for transient failures

### Info Issues (score impact: -0.5)
- Could add defensive checks for robustness
- Missing graceful degradation
- Error messages could be more helpful
- Could validate inputs more strictly

## Examples

### Example 1: Critical - Array.find() Without Null Check
❌ BAD:
\`\`\`typescript
function getUserEmail(userId: string) {
  const user = users.find(u => u.id === userId)
  return user.email // Crashes if user not found
}
\`\`\`

✅ GOOD:
\`\`\`typescript
function getUserEmail(userId: string) {
  const user = users.find(u => u.id === userId)
  if (!user) {
    throw new Error(\`User \${userId} not found\`)
  }
  return user.email
}
\`\`\`

Finding format:
{
  "severity": "critical",
  "title": "No null check on Array.find() result",
  "description": "Array.find() returns undefined when no match found. Accessing .email property will crash with 'Cannot read property email of undefined'.",
  "line": 3,
  "suggestion": "Add null check: if (!user) throw new Error('User not found')"
}

### Example 2: Critical - Division by Zero
❌ BAD:
\`\`\`typescript
function calculateAverage(numbers: number[]) {
  const sum = numbers.reduce((a, b) => a + b, 0)
  return sum / numbers.length // Division by zero if empty array
}
\`\`\`

✅ GOOD:
\`\`\`typescript
function calculateAverage(numbers: number[]) {
  if (numbers.length === 0) {
    throw new Error('Cannot calculate average of empty array')
  }
  const sum = numbers.reduce((a, b) => a + b, 0)
  return sum / numbers.length
}
\`\`\`

### Example 3: Critical - Race Condition
❌ BAD:
\`\`\`typescript
let requestCount = 0

async function handleRequest() {
  requestCount++ // Race condition
  if (requestCount > 100) {
    throw new Error('Rate limit exceeded')
  }
  await processRequest()
  requestCount-- // Race condition
}
\`\`\`

✅ GOOD:
\`\`\`typescript
import { Semaphore } from 'async-mutex'
const semaphore = new Semaphore(100)

async function handleRequest() {
  const [value, release] = await semaphore.acquire()
  try {
    await processRequest()
  } finally {
    release()
  }
}
\`\`\`

Finding format:
{
  "severity": "critical",
  "title": "Race condition in rate limiting",
  "description": "Multiple concurrent calls can read/write requestCount simultaneously, leading to incorrect count and bypassed rate limit.",
  "line": 4,
  "suggestion": "Use atomic operations or semaphore: import { Semaphore } from 'async-mutex'"
}

### Example 4: Warning - No Timeout on Network Request
❌ BAD:
\`\`\`typescript
async function fetchData(url: string) {
  const response = await fetch(url) // No timeout, could hang forever
  return response.json()
}
\`\`\`

✅ GOOD:
\`\`\`typescript
async function fetchData(url: string) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(url, { signal: controller.signal })
    return response.json()
  } finally {
    clearTimeout(timeout)
  }
}
\`\`\`

### Example 5: Warning - Array Access Without Bounds Check
❌ BAD:
\`\`\`typescript
function getFirstThree(items: string[]) {
  return [items[0], items[1], items[2]] // Undefined if array has <3 items
}
\`\`\`

✅ GOOD:
\`\`\`typescript
function getFirstThree(items: string[]) {
  if (items.length < 3) {
    throw new Error('Array must have at least 3 items')
  }
  return [items[0], items[1], items[2]]
}
\`\`\`

### Example 6: DO NOT FLAG - Handled Edge Cases
✅ CORRECT:
\`\`\`typescript
const user = users.find(u => u.id === id) ?? defaultUser
\`\`\`
Uses nullish coalescing to handle not-found case - DO NOT flag.

✅ CORRECT:
\`\`\`typescript
try {
  const result = await riskyOperation()
} catch (error) {
  console.error('Operation failed:', error)
  return fallbackValue
}
\`\`\`
Error is properly handled - DO NOT flag.

## Constraints
- Only flag genuine edge cases and error handling gaps (>80% confidence)
- Don't flag overly defensive code (checking for impossible conditions)
- Consider language/framework protections:
  - TypeScript prevents many type-related edge cases
  - React handles many rendering edge cases
  - Modern DBs handle connection pooling
- Don't flag edge cases that are intentionally not handled (with comments)
- Suggestions must include concrete error handling code

## Output Format
Return JSON only, no markdown, no explanatory text outside JSON:
{
  "score": <number 0-10, where 10 is perfectly robust>,
  "summary": "<1-2 sentences: overall robustness assessment>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<specific edge case in <50 chars>",
      "description": "<what happens in edge case scenario>",
      "file": "<exact filename>",
      "line": <exact line number>,
      "suggestion": "<concrete fix with error handling code>"
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

  return `Analyze the following code for edge case handling and robustness:\n\n${fileContents}\n\nReturn your analysis as JSON.`;
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

export const edgeCasesAgent: AgentDefinition = {
  name: AGENT_NAME,
  weight: WEIGHT,
  systemPrompt: SYSTEM_PROMPT,
  userPromptTemplate: createUserPrompt,
  parseResponse,
};
