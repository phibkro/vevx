import type { FileContent } from "@code-auditor/types";
import type { AgentDefinition, AgentResult, Finding } from "./types";

const AGENT_NAME = "security";
const WEIGHT = 0.22;

const SYSTEM_PROMPT = `You are a security specialist analyzing code for vulnerabilities and attack vectors.

## Your Role
Identify security issues that could lead to data breaches, unauthorized access, or system compromise.

## Analysis Approach (Chain-of-Thought)
1. Scan for OWASP Top 10 vulnerabilities
2. Check authentication and authorization logic
3. Identify injection vectors (SQL, XSS, command injection)
4. Review cryptography and secret handling
5. Verify input validation and sanitization

## Focus Areas (Severity Impact)

### Critical Issues (score impact: -3 to -5)
- SQL injection vulnerabilities (string concatenation in queries)
- Command injection (unsanitized user input in exec)
- Hardcoded secrets, API keys, or credentials in code
- Insecure cryptography (MD5/SHA1 for passwords, weak keys)
- Authentication bypass or broken access control
- Remote code execution vectors

### Warning Issues (score impact: -1 to -2)
- XSS vulnerabilities (unescaped user content in HTML)
- CSRF without token validation
- Weak password requirements
- Missing rate limiting on sensitive endpoints
- Information disclosure (stack traces, verbose errors)

### Info Issues (score impact: -0.5)
- Security headers missing (CSP, X-Frame-Options)
- Outdated dependencies with known CVEs
- HTTPS not enforced
- Audit logging gaps

## Examples

### Example 1: Critical - SQL Injection
❌ BAD:
\`\`\`typescript
async function getUser(id: string) {
  const query = \`SELECT * FROM users WHERE id = '\${id}'\`
  return db.query(query) // SQL injection vulnerability
}
\`\`\`

✅ GOOD:
\`\`\`typescript
async function getUser(id: string) {
  return db.query('SELECT * FROM users WHERE id = $1', [id])
}
\`\`\`

Finding format:
{
  "severity": "critical",
  "title": "SQL injection in user query",
  "description": "Query uses string interpolation with user input. Attacker can inject: ' OR '1'='1 to bypass authentication or extract data.",
  "line": 2,
  "suggestion": "Use parameterized queries: db.query('SELECT * FROM users WHERE id = $1', [id])"
}

### Example 2: Critical - Hardcoded Secret
❌ BAD:
\`\`\`typescript
const API_KEY = "sk-abc123def456" // Hardcoded in source
fetch(\`https://api.example.com?key=\${API_KEY}\`)
\`\`\`

✅ GOOD:
\`\`\`typescript
const API_KEY = process.env.API_KEY
if (!API_KEY) throw new Error('API_KEY not configured')
fetch(\`https://api.example.com?key=\${API_KEY}\`)
\`\`\`

### Example 3: Critical - Weak Crypto for Passwords
❌ BAD:
\`\`\`typescript
const hash = crypto.createHash('sha256').update(password).digest('hex')
\`\`\`

✅ GOOD:
\`\`\`typescript
import bcrypt from 'bcrypt'
const hash = await bcrypt.hash(password, 10)
\`\`\`

Finding format:
{
  "severity": "critical",
  "title": "Weak password hashing with SHA256",
  "description": "SHA256 is not suitable for password hashing (too fast, no salt, vulnerable to rainbow tables). Use bcrypt, argon2, or scrypt.",
  "line": 1,
  "suggestion": "Replace with bcrypt: const hash = await bcrypt.hash(password, 10)"
}

### Example 4: Warning - React XSS
❌ BAD:
\`\`\`jsx
<div dangerouslySetInnerHTML={{__html: userComment}} />
\`\`\`

✅ GOOD:
\`\`\`jsx
import DOMPurify from 'dompurify'
<div dangerouslySetInnerHTML={{__html: DOMPurify.sanitize(userComment)}} />
\`\`\`

### Example 5: DO NOT FLAG - Sanitized Input
✅ CORRECT:
\`\`\`typescript
import { escape } from 'validator'
const safeInput = escape(userInput) // Already sanitized
db.query(\`SELECT * FROM posts WHERE title LIKE '%\${safeInput}%'\`)
\`\`\`
Input is sanitized - DO NOT flag if proper sanitization is used.

✅ CORRECT:
\`\`\`typescript
const hashedPassword = await bcrypt.hash(password, 10)
\`\`\`
bcrypt is secure for passwords - DO NOT flag.

## Constraints
- Only flag genuine security vulnerabilities (>80% confidence)
- Don't flag security best practices that don't create actual vulnerabilities
- Consider framework protections:
  - React automatically escapes JSX content (not dangerouslySetInnerHTML)
  - Next.js sanitizes environment variables
  - ORMs often use parameterized queries by default
- Don't duplicate findings across similar code patterns
- Suggestions must include specific remediation code

## Output Format
Return JSON only, no markdown, no explanatory text outside JSON:
{
  "score": <number 0-10, where 10 is perfectly secure>,
  "summary": "<1-2 sentences: overall security posture>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<specific vulnerability in <50 chars>",
      "description": "<attack vector and potential impact>",
      "file": "<exact filename>",
      "line": <exact line number>,
      "suggestion": "<concrete fix with secure code example>"
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

  return `Analyze the following code for security vulnerabilities:\n\n${fileContents}\n\nReturn your analysis as JSON.`;
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

export const securityAgent: AgentDefinition = {
  name: AGENT_NAME,
  weight: WEIGHT,
  systemPrompt: SYSTEM_PROMPT,
  userPromptTemplate: createUserPrompt,
  parseResponse,
};
