#!/usr/bin/env bun
// @bun
var __create = Object.create;
var __getProtoOf = Object.getPrototypeOf;
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  const to = isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp(to, key, {
        get: () => mod[key],
        enumerable: true
      });
  return to;
};
var __require = import.meta.require;

// src/cli.ts
import { parseArgs } from "util";
import { writeFileSync as writeFileSync2, readFileSync as readFileSync4 } from "fs";
import { resolve as resolve3, dirname } from "path";
import { fileURLToPath } from "url";

// src/config.ts
import { readFileSync } from "fs";
import { resolve } from "path";
var DEFAULT_CONFIG = {
  model: "claude-sonnet-4-5-20250929",
  maxTokensPerChunk: 1e5,
  parallel: true
};
function loadConfig(cliArgs = {}) {
  let fileConfig = {};
  try {
    const configPath = resolve(process.cwd(), ".code-audit.json");
    const configContent = readFileSync(configPath, "utf-8");
    fileConfig = JSON.parse(configContent);
  } catch (error) {
    if (error instanceof Error && !error.message.includes("ENOENT")) {
      console.warn(`Warning: Failed to parse .code-audit.json: ${error.message}`);
    }
  }
  const filteredCliArgs = Object.fromEntries(Object.entries(cliArgs).filter(([_, v]) => v !== undefined));
  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...filteredCliArgs
  };
}
function validateConfig(config) {
  if (config.maxTokensPerChunk < 1000) {
    throw new Error("maxTokensPerChunk must be at least 1000");
  }
  if (!config.model || config.model.trim().length === 0) {
    throw new Error("model must be specified");
  }
}

// src/discovery.ts
var {Glob } = globalThis.Bun;
import { readFileSync as readFileSync2, statSync } from "fs";
import { resolve as resolve2, relative, join } from "path";
var LANGUAGE_MAP = {
  ".ts": "typescript",
  ".tsx": "typescript",
  ".js": "javascript",
  ".jsx": "javascript",
  ".py": "python",
  ".go": "go",
  ".java": "java",
  ".rs": "rust",
  ".c": "c",
  ".cpp": "cpp",
  ".h": "c",
  ".hpp": "cpp"
};
var SUPPORTED_EXTENSIONS = Object.keys(LANGUAGE_MAP);
function parseGitignore(basePath) {
  const patterns = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".DS_Store",
    "*.min.js",
    "*.bundle.js"
  ];
  try {
    const gitignorePath = join(basePath, ".gitignore");
    const content = readFileSync2(gitignorePath, "utf-8");
    content.split(`
`).forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        patterns.push(trimmed);
      }
    });
  } catch (error) {}
  return patterns;
}
function shouldIgnore(path, ignorePatterns) {
  const normalizedPath = path.replace(/\\/g, "/");
  for (const pattern of ignorePatterns) {
    if (pattern.endsWith("/")) {
      const dirPattern = pattern.slice(0, -1);
      if (normalizedPath.includes(`/${dirPattern}/`) || normalizedPath.includes(`${dirPattern}/`)) {
        return true;
      }
    } else if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      if (normalizedPath.endsWith(suffix)) {
        return true;
      }
    } else {
      if (normalizedPath.includes(pattern)) {
        return true;
      }
    }
  }
  return false;
}
function detectLanguage(filePath) {
  const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
  return LANGUAGE_MAP[ext] || null;
}
function isBinaryFile(filePath, sampleSize = 512) {
  try {
    const buffer = Buffer.alloc(sampleSize);
    const fd = Bun.file(filePath);
    const sample = fd.slice(0, sampleSize);
    return sample.toString().includes("\x00");
  } catch {
    return false;
  }
}
async function discoverFiles(targetPath) {
  const absolutePath = resolve2(targetPath);
  const files = [];
  try {
    const stat = statSync(absolutePath);
    if (stat.isFile()) {
      const language = detectLanguage(absolutePath);
      if (!language) {
        throw new Error(`Unsupported file type: ${absolutePath}
Supported extensions: ${SUPPORTED_EXTENSIONS.join(", ")}`);
      }
      if (isBinaryFile(absolutePath)) {
        throw new Error(`File appears to be binary: ${absolutePath}`);
      }
      const content = readFileSync2(absolutePath, "utf-8");
      files.push({
        path: absolutePath,
        relativePath: relative(process.cwd(), absolutePath),
        language,
        content,
        size: stat.size
      });
      return files;
    }
    const ignorePatterns = parseGitignore(absolutePath);
    const basePath = absolutePath;
    const globPattern = `**/*{${SUPPORTED_EXTENSIONS.join(",")}}`;
    const glob = new Glob(globPattern);
    for await (const filePath of glob.scan({ cwd: basePath, absolute: true })) {
      const fullPath = String(filePath);
      const relPath = relative(basePath, fullPath);
      if (shouldIgnore(relPath, ignorePatterns)) {
        continue;
      }
      if (isBinaryFile(fullPath)) {
        continue;
      }
      const language = detectLanguage(fullPath);
      if (!language) {
        continue;
      }
      try {
        const content = readFileSync2(fullPath, "utf-8");
        const stat2 = statSync(fullPath);
        files.push({
          path: fullPath,
          relativePath: relative(process.cwd(), fullPath),
          language,
          content,
          size: stat2.size
        });
      } catch (error) {
        console.warn(`Warning: Could not read file ${fullPath}: ${error}`);
      }
    }
    if (files.length === 0) {
      throw new Error(`No supported code files found in ${absolutePath}
Supported extensions: ${SUPPORTED_EXTENSIONS.join(", ")}`);
    }
    return files;
  } catch (error) {
    if (error instanceof Error && error.message.includes("ENOENT")) {
      throw new Error(`Path not found: ${absolutePath}`);
    }
    throw error;
  }
}

// src/chunker.ts
var CHARS_PER_TOKEN = 4;
var SAFETY_MARGIN = 0.9;
function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}
function estimateFileTokens(file) {
  const metadata = `File: ${file.relativePath}
Language: ${file.language}

`;
  return estimateTokens(metadata + file.content);
}
function truncateFile(file, maxTokens) {
  const fileTokens = estimateFileTokens(file);
  if (fileTokens <= maxTokens) {
    return file;
  }
  const metadata = `File: ${file.relativePath}
Language: ${file.language}

`;
  const metadataTokens = estimateTokens(metadata);
  const availableTokens = maxTokens - metadataTokens - estimateTokens(`

[... truncated ...]`);
  const maxChars = availableTokens * CHARS_PER_TOKEN;
  const truncatedContent = file.content.substring(0, maxChars) + `

[... truncated ...]`;
  console.warn(`Warning: File ${file.relativePath} exceeds token budget (${fileTokens} tokens). Truncating to ${maxTokens} tokens.`);
  return {
    ...file,
    content: truncatedContent
  };
}
function createChunks(files, maxTokensPerChunk) {
  if (files.length === 0) {
    return [];
  }
  const effectiveMax = Math.floor(maxTokensPerChunk * SAFETY_MARGIN);
  const chunks = [];
  let currentChunk = [];
  let currentTokens = 0;
  for (const file of files) {
    let processedFile = file;
    let fileTokens = estimateFileTokens(file);
    if (fileTokens > effectiveMax) {
      if (currentChunk.length > 0) {
        chunks.push({
          files: currentChunk,
          estimatedTokens: currentTokens
        });
        currentChunk = [];
        currentTokens = 0;
      }
      processedFile = truncateFile(file, effectiveMax);
      fileTokens = estimateFileTokens(processedFile);
      chunks.push({
        files: [processedFile],
        estimatedTokens: fileTokens
      });
      continue;
    }
    if (currentTokens + fileTokens > effectiveMax && currentChunk.length > 0) {
      chunks.push({
        files: currentChunk,
        estimatedTokens: currentTokens
      });
      currentChunk = [];
      currentTokens = 0;
    }
    currentChunk.push(processedFile);
    currentTokens += fileTokens;
  }
  if (currentChunk.length > 0) {
    chunks.push({
      files: currentChunk,
      estimatedTokens: currentTokens
    });
  }
  return chunks;
}
function formatChunkSummary(chunks) {
  const totalFiles = chunks.reduce((sum, chunk) => sum + chunk.files.length, 0);
  const totalTokens = chunks.reduce((sum, chunk) => sum + chunk.estimatedTokens, 0);
  const lines = [
    `Created ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}:`,
    `  Total files: ${totalFiles}`,
    `  Estimated tokens: ${totalTokens.toLocaleString()}`,
    ""
  ];
  chunks.forEach((chunk, index) => {
    lines.push(`  Chunk ${index + 1}: ${chunk.files.length} file${chunk.files.length === 1 ? "" : "s"}, ~${chunk.estimatedTokens.toLocaleString()} tokens`);
  });
  return lines.join(`
`);
}

// src/agents/correctness.ts
var AGENT_NAME = "correctness";
var WEIGHT = 0.25;
var SYSTEM_PROMPT = `You are a correctness specialist analyzing code for logic errors, type safety issues, and behavioral bugs.

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
function createUserPrompt(files) {
  const fileContents = files.map((file) => {
    const lines = file.content.split(`
`);
    const numberedLines = lines.map((line, index) => `${index + 1}\u2192${line}`).join(`
`);
    return `File: ${file.relativePath}
Language: ${file.language}

${numberedLines}`;
  }).join(`

---

`);
  return `Analyze the following code for correctness issues:

${fileContents}

Return your analysis as JSON.`;
}
function parseResponse(raw) {
  const startTime = Date.now();
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
    const findings = parsed.findings.map((f) => ({
      severity: f.severity || "info",
      title: f.title || "Untitled issue",
      description: f.description || "",
      file: f.file || "unknown",
      line: f.line,
      suggestion: f.suggestion
    }));
    return {
      agent: AGENT_NAME,
      score: parsed.score,
      findings,
      summary: parsed.summary,
      durationMs: 0
    };
  } catch (error) {
    console.warn(`Failed to parse JSON from ${AGENT_NAME} agent: ${error}`);
    return {
      agent: AGENT_NAME,
      score: 5,
      findings: [
        {
          severity: "warning",
          title: "Agent response parsing failed",
          description: `Could not parse structured response: ${error}. Raw response: ${raw.substring(0, 200)}...`,
          file: "unknown"
        }
      ],
      summary: "Analysis completed but response format was invalid",
      durationMs: 0
    };
  }
}
var correctnessAgent = {
  name: AGENT_NAME,
  weight: WEIGHT,
  systemPrompt: SYSTEM_PROMPT,
  userPromptTemplate: createUserPrompt,
  parseResponse
};

// src/agents/security.ts
var AGENT_NAME2 = "security";
var WEIGHT2 = 0.25;
var SYSTEM_PROMPT2 = `You are a security specialist analyzing code for vulnerabilities and attack vectors.

Your focus areas:
- OWASP Top 10 vulnerabilities (injection, XSS, CSRF, etc.)
- SQL injection and NoSQL injection vectors
- Command injection and code injection risks
- Authentication and authorization flaws
- Hardcoded secrets, API keys, or credentials
- Insecure cryptography or weak hashing
- Path traversal vulnerabilities
- Insecure deserialization
- Dependency vulnerabilities
- Sensitive data exposure
- Security misconfigurations

Prioritize issues that could lead to:
1. Remote code execution
2. Data breaches or unauthorized access
3. Privilege escalation
4. Denial of service
5. Information disclosure

Ignore non-security issues like style or performance unless they create security risks.

Return your analysis as JSON with this exact structure:
{
  "score": <number 0-10, where 10 is perfectly secure>,
  "summary": "<brief 1-2 sentence summary of security posture>",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "title": "<short title>",
      "description": "<detailed explanation of vulnerability>",
      "file": "<filename>",
      "line": <line number or omit if not applicable>,
      "suggestion": "<how to fix the vulnerability>"
    }
  ]
}`;
function createUserPrompt2(files) {
  const fileContents = files.map((file) => {
    const lines = file.content.split(`
`);
    const numberedLines = lines.map((line, index) => `${index + 1}\u2192${line}`).join(`
`);
    return `File: ${file.relativePath}
Language: ${file.language}

${numberedLines}`;
  }).join(`

---

`);
  return `Analyze the following code for security vulnerabilities:

${fileContents}

Return your analysis as JSON.`;
}
function parseResponse2(raw) {
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
    const findings = parsed.findings.map((f) => ({
      severity: f.severity || "info",
      title: f.title || "Untitled issue",
      description: f.description || "",
      file: f.file || "unknown",
      line: f.line,
      suggestion: f.suggestion
    }));
    return {
      agent: AGENT_NAME2,
      score: parsed.score,
      findings,
      summary: parsed.summary,
      durationMs: 0
    };
  } catch (error) {
    console.warn(`Failed to parse JSON from ${AGENT_NAME2} agent: ${error}`);
    return {
      agent: AGENT_NAME2,
      score: 5,
      findings: [
        {
          severity: "warning",
          title: "Agent response parsing failed",
          description: `Could not parse structured response: ${error}. Raw response: ${raw.substring(0, 200)}...`,
          file: "unknown"
        }
      ],
      summary: "Analysis completed but response format was invalid",
      durationMs: 0
    };
  }
}
var securityAgent = {
  name: AGENT_NAME2,
  weight: WEIGHT2,
  systemPrompt: SYSTEM_PROMPT2,
  userPromptTemplate: createUserPrompt2,
  parseResponse: parseResponse2
};

// src/agents/performance.ts
var AGENT_NAME3 = "performance";
var WEIGHT3 = 0.15;
var SYSTEM_PROMPT3 = `You are a performance specialist analyzing code for bottlenecks and inefficiencies.

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
function createUserPrompt3(files) {
  const fileContents = files.map((file) => {
    const lines = file.content.split(`
`);
    const numberedLines = lines.map((line, index) => `${index + 1}\u2192${line}`).join(`
`);
    return `File: ${file.relativePath}
Language: ${file.language}

${numberedLines}`;
  }).join(`

---

`);
  return `Analyze the following code for performance issues:

${fileContents}

Return your analysis as JSON.`;
}
function parseResponse3(raw) {
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
    const findings = parsed.findings.map((f) => ({
      severity: f.severity || "info",
      title: f.title || "Untitled issue",
      description: f.description || "",
      file: f.file || "unknown",
      line: f.line,
      suggestion: f.suggestion
    }));
    return {
      agent: AGENT_NAME3,
      score: parsed.score,
      findings,
      summary: parsed.summary,
      durationMs: 0
    };
  } catch (error) {
    console.warn(`Failed to parse JSON from ${AGENT_NAME3} agent: ${error}`);
    return {
      agent: AGENT_NAME3,
      score: 5,
      findings: [
        {
          severity: "warning",
          title: "Agent response parsing failed",
          description: `Could not parse structured response: ${error}. Raw response: ${raw.substring(0, 200)}...`,
          file: "unknown"
        }
      ],
      summary: "Analysis completed but response format was invalid",
      durationMs: 0
    };
  }
}
var performanceAgent = {
  name: AGENT_NAME3,
  weight: WEIGHT3,
  systemPrompt: SYSTEM_PROMPT3,
  userPromptTemplate: createUserPrompt3,
  parseResponse: parseResponse3
};

// src/agents/maintainability.ts
var AGENT_NAME4 = "maintainability";
var WEIGHT4 = 0.2;
var SYSTEM_PROMPT4 = `You are a maintainability specialist analyzing code for readability and long-term maintenance issues.

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
function createUserPrompt4(files) {
  const fileContents = files.map((file) => {
    const lines = file.content.split(`
`);
    const numberedLines = lines.map((line, index) => `${index + 1}\u2192${line}`).join(`
`);
    return `File: ${file.relativePath}
Language: ${file.language}

${numberedLines}`;
  }).join(`

---

`);
  return `Analyze the following code for maintainability issues:

${fileContents}

Return your analysis as JSON.`;
}
function parseResponse4(raw) {
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
    const findings = parsed.findings.map((f) => ({
      severity: f.severity || "info",
      title: f.title || "Untitled issue",
      description: f.description || "",
      file: f.file || "unknown",
      line: f.line,
      suggestion: f.suggestion
    }));
    return {
      agent: AGENT_NAME4,
      score: parsed.score,
      findings,
      summary: parsed.summary,
      durationMs: 0
    };
  } catch (error) {
    console.warn(`Failed to parse JSON from ${AGENT_NAME4} agent: ${error}`);
    return {
      agent: AGENT_NAME4,
      score: 5,
      findings: [
        {
          severity: "warning",
          title: "Agent response parsing failed",
          description: `Could not parse structured response: ${error}. Raw response: ${raw.substring(0, 200)}...`,
          file: "unknown"
        }
      ],
      summary: "Analysis completed but response format was invalid",
      durationMs: 0
    };
  }
}
var maintainabilityAgent = {
  name: AGENT_NAME4,
  weight: WEIGHT4,
  systemPrompt: SYSTEM_PROMPT4,
  userPromptTemplate: createUserPrompt4,
  parseResponse: parseResponse4
};

// src/agents/edge-cases.ts
var AGENT_NAME5 = "edge-cases";
var WEIGHT5 = 0.15;
var SYSTEM_PROMPT5 = `You are an edge case specialist analyzing code for robustness and error handling.

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
function createUserPrompt5(files) {
  const fileContents = files.map((file) => {
    const lines = file.content.split(`
`);
    const numberedLines = lines.map((line, index) => `${index + 1}\u2192${line}`).join(`
`);
    return `File: ${file.relativePath}
Language: ${file.language}

${numberedLines}`;
  }).join(`

---

`);
  return `Analyze the following code for edge case handling and robustness:

${fileContents}

Return your analysis as JSON.`;
}
function parseResponse5(raw) {
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
    const findings = parsed.findings.map((f) => ({
      severity: f.severity || "info",
      title: f.title || "Untitled issue",
      description: f.description || "",
      file: f.file || "unknown",
      line: f.line,
      suggestion: f.suggestion
    }));
    return {
      agent: AGENT_NAME5,
      score: parsed.score,
      findings,
      summary: parsed.summary,
      durationMs: 0
    };
  } catch (error) {
    console.warn(`Failed to parse JSON from ${AGENT_NAME5} agent: ${error}`);
    return {
      agent: AGENT_NAME5,
      score: 5,
      findings: [
        {
          severity: "warning",
          title: "Agent response parsing failed",
          description: `Could not parse structured response: ${error}. Raw response: ${raw.substring(0, 200)}...`,
          file: "unknown"
        }
      ],
      summary: "Analysis completed but response format was invalid",
      durationMs: 0
    };
  }
}
var edgeCasesAgent = {
  name: AGENT_NAME5,
  weight: WEIGHT5,
  systemPrompt: SYSTEM_PROMPT5,
  userPromptTemplate: createUserPrompt5,
  parseResponse: parseResponse5
};

// src/agents/index.ts
var agents = [
  correctnessAgent,
  securityAgent,
  performanceAgent,
  maintainabilityAgent,
  edgeCasesAgent
];
function validateWeights() {
  const totalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0);
  const tolerance = 0.0001;
  if (Math.abs(totalWeight - 1) > tolerance) {
    throw new Error(`Agent weights must sum to 1.0, but got ${totalWeight}. ` + `Weights: ${agents.map((a) => `${a.name}=${a.weight}`).join(", ")}`);
  }
}
validateWeights();

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/version.mjs
var VERSION = "0.32.1";

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/_shims/registry.mjs
var auto = false;
var kind = undefined;
var fetch2 = undefined;
var Request2 = undefined;
var Response2 = undefined;
var Headers2 = undefined;
var FormData2 = undefined;
var Blob2 = undefined;
var File2 = undefined;
var ReadableStream2 = undefined;
var getMultipartRequestOptions = undefined;
var getDefaultAgent = undefined;
var fileFromPath = undefined;
var isFsReadStream = undefined;
function setShims(shims, options = { auto: false }) {
  if (auto) {
    throw new Error(`you must \`import '@anthropic-ai/sdk/shims/${shims.kind}'\` before importing anything else from @anthropic-ai/sdk`);
  }
  if (kind) {
    throw new Error(`can't \`import '@anthropic-ai/sdk/shims/${shims.kind}'\` after \`import '@anthropic-ai/sdk/shims/${kind}'\``);
  }
  auto = options.auto;
  kind = shims.kind;
  fetch2 = shims.fetch;
  Request2 = shims.Request;
  Response2 = shims.Response;
  Headers2 = shims.Headers;
  FormData2 = shims.FormData;
  Blob2 = shims.Blob;
  File2 = shims.File;
  ReadableStream2 = shims.ReadableStream;
  getMultipartRequestOptions = shims.getMultipartRequestOptions;
  getDefaultAgent = shims.getDefaultAgent;
  fileFromPath = shims.fileFromPath;
  isFsReadStream = shims.isFsReadStream;
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/_shims/MultipartBody.mjs
class MultipartBody {
  constructor(body) {
    this.body = body;
  }
  get [Symbol.toStringTag]() {
    return "MultipartBody";
  }
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/_shims/web-runtime.mjs
function getRuntime({ manuallyImported } = {}) {
  const recommendation = manuallyImported ? `You may need to use polyfills` : `Add one of these imports before your first \`import \u2026 from '@anthropic-ai/sdk'\`:
- \`import '@anthropic-ai/sdk/shims/node'\` (if you're running on Node)
- \`import '@anthropic-ai/sdk/shims/web'\` (otherwise)
`;
  let _fetch, _Request, _Response, _Headers;
  try {
    _fetch = fetch;
    _Request = Request;
    _Response = Response;
    _Headers = Headers;
  } catch (error) {
    throw new Error(`this environment is missing the following Web Fetch API type: ${error.message}. ${recommendation}`);
  }
  return {
    kind: "web",
    fetch: _fetch,
    Request: _Request,
    Response: _Response,
    Headers: _Headers,
    FormData: typeof FormData !== "undefined" ? FormData : class FormData3 {
      constructor() {
        throw new Error(`file uploads aren't supported in this environment yet as 'FormData' is undefined. ${recommendation}`);
      }
    },
    Blob: typeof Blob !== "undefined" ? Blob : class Blob3 {
      constructor() {
        throw new Error(`file uploads aren't supported in this environment yet as 'Blob' is undefined. ${recommendation}`);
      }
    },
    File: typeof File !== "undefined" ? File : class File3 {
      constructor() {
        throw new Error(`file uploads aren't supported in this environment yet as 'File' is undefined. ${recommendation}`);
      }
    },
    ReadableStream: typeof ReadableStream !== "undefined" ? ReadableStream : class ReadableStream3 {
      constructor() {
        throw new Error(`streaming isn't supported in this environment yet as 'ReadableStream' is undefined. ${recommendation}`);
      }
    },
    getMultipartRequestOptions: async (form, opts) => ({
      ...opts,
      body: new MultipartBody(form)
    }),
    getDefaultAgent: (url) => {
      return;
    },
    fileFromPath: () => {
      throw new Error("The `fileFromPath` function is only supported in Node. See the README for more details: https://www.github.com/anthropics/anthropic-sdk-typescript#file-uploads");
    },
    isFsReadStream: (value) => false
  };
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/_shims/bun-runtime.mjs
import { ReadStream as FsReadStream } from "fs";
function getRuntime2() {
  const runtime = getRuntime();
  function isFsReadStream2(value) {
    return value instanceof FsReadStream;
  }
  return { ...runtime, isFsReadStream: isFsReadStream2 };
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/_shims/index.mjs
if (!kind)
  setShims(getRuntime2(), { auto: true });

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/error.mjs
class AnthropicError extends Error {
}

class APIError extends AnthropicError {
  constructor(status, error, message, headers) {
    super(`${APIError.makeMessage(status, error, message)}`);
    this.status = status;
    this.headers = headers;
    this.request_id = headers?.["request-id"];
    this.error = error;
  }
  static makeMessage(status, error, message) {
    const msg = error?.message ? typeof error.message === "string" ? error.message : JSON.stringify(error.message) : error ? JSON.stringify(error) : message;
    if (status && msg) {
      return `${status} ${msg}`;
    }
    if (status) {
      return `${status} status code (no body)`;
    }
    if (msg) {
      return msg;
    }
    return "(no status code or body)";
  }
  static generate(status, errorResponse, message, headers) {
    if (!status) {
      return new APIConnectionError({ message, cause: castToError(errorResponse) });
    }
    const error = errorResponse;
    if (status === 400) {
      return new BadRequestError(status, error, message, headers);
    }
    if (status === 401) {
      return new AuthenticationError(status, error, message, headers);
    }
    if (status === 403) {
      return new PermissionDeniedError(status, error, message, headers);
    }
    if (status === 404) {
      return new NotFoundError(status, error, message, headers);
    }
    if (status === 409) {
      return new ConflictError(status, error, message, headers);
    }
    if (status === 422) {
      return new UnprocessableEntityError(status, error, message, headers);
    }
    if (status === 429) {
      return new RateLimitError(status, error, message, headers);
    }
    if (status >= 500) {
      return new InternalServerError(status, error, message, headers);
    }
    return new APIError(status, error, message, headers);
  }
}

class APIUserAbortError extends APIError {
  constructor({ message } = {}) {
    super(undefined, undefined, message || "Request was aborted.", undefined);
    this.status = undefined;
  }
}

class APIConnectionError extends APIError {
  constructor({ message, cause }) {
    super(undefined, undefined, message || "Connection error.", undefined);
    this.status = undefined;
    if (cause)
      this.cause = cause;
  }
}

class APIConnectionTimeoutError extends APIConnectionError {
  constructor({ message } = {}) {
    super({ message: message ?? "Request timed out." });
  }
}

class BadRequestError extends APIError {
  constructor() {
    super(...arguments);
    this.status = 400;
  }
}

class AuthenticationError extends APIError {
  constructor() {
    super(...arguments);
    this.status = 401;
  }
}

class PermissionDeniedError extends APIError {
  constructor() {
    super(...arguments);
    this.status = 403;
  }
}

class NotFoundError extends APIError {
  constructor() {
    super(...arguments);
    this.status = 404;
  }
}

class ConflictError extends APIError {
  constructor() {
    super(...arguments);
    this.status = 409;
  }
}

class UnprocessableEntityError extends APIError {
  constructor() {
    super(...arguments);
    this.status = 422;
  }
}

class RateLimitError extends APIError {
  constructor() {
    super(...arguments);
    this.status = 429;
  }
}

class InternalServerError extends APIError {
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/internal/decoders/line.mjs
class LineDecoder {
  constructor() {
    this.buffer = [];
    this.trailingCR = false;
  }
  decode(chunk) {
    let text = this.decodeText(chunk);
    if (this.trailingCR) {
      text = "\r" + text;
      this.trailingCR = false;
    }
    if (text.endsWith("\r")) {
      this.trailingCR = true;
      text = text.slice(0, -1);
    }
    if (!text) {
      return [];
    }
    const trailingNewline = LineDecoder.NEWLINE_CHARS.has(text[text.length - 1] || "");
    let lines = text.split(LineDecoder.NEWLINE_REGEXP);
    if (trailingNewline) {
      lines.pop();
    }
    if (lines.length === 1 && !trailingNewline) {
      this.buffer.push(lines[0]);
      return [];
    }
    if (this.buffer.length > 0) {
      lines = [this.buffer.join("") + lines[0], ...lines.slice(1)];
      this.buffer = [];
    }
    if (!trailingNewline) {
      this.buffer = [lines.pop() || ""];
    }
    return lines;
  }
  decodeText(bytes) {
    if (bytes == null)
      return "";
    if (typeof bytes === "string")
      return bytes;
    if (typeof Buffer !== "undefined") {
      if (bytes instanceof Buffer) {
        return bytes.toString();
      }
      if (bytes instanceof Uint8Array) {
        return Buffer.from(bytes).toString();
      }
      throw new AnthropicError(`Unexpected: received non-Uint8Array (${bytes.constructor.name}) stream chunk in an environment with a global "Buffer" defined, which this library assumes to be Node. Please report this error.`);
    }
    if (typeof TextDecoder !== "undefined") {
      if (bytes instanceof Uint8Array || bytes instanceof ArrayBuffer) {
        this.textDecoder ?? (this.textDecoder = new TextDecoder("utf8"));
        return this.textDecoder.decode(bytes);
      }
      throw new AnthropicError(`Unexpected: received non-Uint8Array/ArrayBuffer (${bytes.constructor.name}) in a web platform. Please report this error.`);
    }
    throw new AnthropicError(`Unexpected: neither Buffer nor TextDecoder are available as globals. Please report this error.`);
  }
  flush() {
    if (!this.buffer.length && !this.trailingCR) {
      return [];
    }
    const lines = [this.buffer.join("")];
    this.buffer = [];
    this.trailingCR = false;
    return lines;
  }
}
LineDecoder.NEWLINE_CHARS = new Set([`
`, "\r"]);
LineDecoder.NEWLINE_REGEXP = /\r\n|[\n\r]/g;

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/streaming.mjs
class Stream {
  constructor(iterator, controller) {
    this.iterator = iterator;
    this.controller = controller;
  }
  static fromSSEResponse(response, controller) {
    let consumed = false;
    async function* iterator() {
      if (consumed) {
        throw new Error("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const sse of _iterSSEMessages(response, controller)) {
          if (sse.event === "completion") {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              console.error(`Could not parse message into JSON:`, sse.data);
              console.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (sse.event === "message_start" || sse.event === "message_delta" || sse.event === "message_stop" || sse.event === "content_block_start" || sse.event === "content_block_delta" || sse.event === "content_block_stop") {
            try {
              yield JSON.parse(sse.data);
            } catch (e) {
              console.error(`Could not parse message into JSON:`, sse.data);
              console.error(`From chunk:`, sse.raw);
              throw e;
            }
          }
          if (sse.event === "ping") {
            continue;
          }
          if (sse.event === "error") {
            throw APIError.generate(undefined, `SSE Error: ${sse.data}`, sse.data, createResponseHeaders(response.headers));
          }
        }
        done = true;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError")
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new Stream(iterator, controller);
  }
  static fromReadableStream(readableStream, controller) {
    let consumed = false;
    async function* iterLines() {
      const lineDecoder = new LineDecoder;
      const iter = readableStreamAsyncIterable(readableStream);
      for await (const chunk of iter) {
        for (const line of lineDecoder.decode(chunk)) {
          yield line;
        }
      }
      for (const line of lineDecoder.flush()) {
        yield line;
      }
    }
    async function* iterator() {
      if (consumed) {
        throw new Error("Cannot iterate over a consumed stream, use `.tee()` to split the stream.");
      }
      consumed = true;
      let done = false;
      try {
        for await (const line of iterLines()) {
          if (done)
            continue;
          if (line)
            yield JSON.parse(line);
        }
        done = true;
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError")
          return;
        throw e;
      } finally {
        if (!done)
          controller.abort();
      }
    }
    return new Stream(iterator, controller);
  }
  [Symbol.asyncIterator]() {
    return this.iterator();
  }
  tee() {
    const left = [];
    const right = [];
    const iterator = this.iterator();
    const teeIterator = (queue) => {
      return {
        next: () => {
          if (queue.length === 0) {
            const result = iterator.next();
            left.push(result);
            right.push(result);
          }
          return queue.shift();
        }
      };
    };
    return [
      new Stream(() => teeIterator(left), this.controller),
      new Stream(() => teeIterator(right), this.controller)
    ];
  }
  toReadableStream() {
    const self = this;
    let iter;
    const encoder = new TextEncoder;
    return new ReadableStream2({
      async start() {
        iter = self[Symbol.asyncIterator]();
      },
      async pull(ctrl) {
        try {
          const { value, done } = await iter.next();
          if (done)
            return ctrl.close();
          const bytes = encoder.encode(JSON.stringify(value) + `
`);
          ctrl.enqueue(bytes);
        } catch (err) {
          ctrl.error(err);
        }
      },
      async cancel() {
        await iter.return?.();
      }
    });
  }
}
async function* _iterSSEMessages(response, controller) {
  if (!response.body) {
    controller.abort();
    throw new AnthropicError(`Attempted to iterate over a response with no body`);
  }
  const sseDecoder = new SSEDecoder;
  const lineDecoder = new LineDecoder;
  const iter = readableStreamAsyncIterable(response.body);
  for await (const sseChunk of iterSSEChunks(iter)) {
    for (const line of lineDecoder.decode(sseChunk)) {
      const sse = sseDecoder.decode(line);
      if (sse)
        yield sse;
    }
  }
  for (const line of lineDecoder.flush()) {
    const sse = sseDecoder.decode(line);
    if (sse)
      yield sse;
  }
}
async function* iterSSEChunks(iterator) {
  let data = new Uint8Array;
  for await (const chunk of iterator) {
    if (chunk == null) {
      continue;
    }
    const binaryChunk = chunk instanceof ArrayBuffer ? new Uint8Array(chunk) : typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    let newData = new Uint8Array(data.length + binaryChunk.length);
    newData.set(data);
    newData.set(binaryChunk, data.length);
    data = newData;
    let patternIndex;
    while ((patternIndex = findDoubleNewlineIndex(data)) !== -1) {
      yield data.slice(0, patternIndex);
      data = data.slice(patternIndex);
    }
  }
  if (data.length > 0) {
    yield data;
  }
}
function findDoubleNewlineIndex(buffer) {
  const newline = 10;
  const carriage = 13;
  for (let i = 0;i < buffer.length - 2; i++) {
    if (buffer[i] === newline && buffer[i + 1] === newline) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === carriage) {
      return i + 2;
    }
    if (buffer[i] === carriage && buffer[i + 1] === newline && i + 3 < buffer.length && buffer[i + 2] === carriage && buffer[i + 3] === newline) {
      return i + 4;
    }
  }
  return -1;
}

class SSEDecoder {
  constructor() {
    this.event = null;
    this.data = [];
    this.chunks = [];
  }
  decode(line) {
    if (line.endsWith("\r")) {
      line = line.substring(0, line.length - 1);
    }
    if (!line) {
      if (!this.event && !this.data.length)
        return null;
      const sse = {
        event: this.event,
        data: this.data.join(`
`),
        raw: this.chunks
      };
      this.event = null;
      this.data = [];
      this.chunks = [];
      return sse;
    }
    this.chunks.push(line);
    if (line.startsWith(":")) {
      return null;
    }
    let [fieldname, _, value] = partition(line, ":");
    if (value.startsWith(" ")) {
      value = value.substring(1);
    }
    if (fieldname === "event") {
      this.event = value;
    } else if (fieldname === "data") {
      this.data.push(value);
    }
    return null;
  }
}
function partition(str, delimiter) {
  const index = str.indexOf(delimiter);
  if (index !== -1) {
    return [str.substring(0, index), delimiter, str.substring(index + delimiter.length)];
  }
  return [str, "", ""];
}
function readableStreamAsyncIterable(stream) {
  if (stream[Symbol.asyncIterator])
    return stream;
  const reader = stream.getReader();
  return {
    async next() {
      try {
        const result = await reader.read();
        if (result?.done)
          reader.releaseLock();
        return result;
      } catch (e) {
        reader.releaseLock();
        throw e;
      }
    },
    async return() {
      const cancelPromise = reader.cancel();
      reader.releaseLock();
      await cancelPromise;
      return { done: true, value: undefined };
    },
    [Symbol.asyncIterator]() {
      return this;
    }
  };
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/uploads.mjs
var isResponseLike = (value) => value != null && typeof value === "object" && typeof value.url === "string" && typeof value.blob === "function";
var isFileLike = (value) => value != null && typeof value === "object" && typeof value.name === "string" && typeof value.lastModified === "number" && isBlobLike(value);
var isBlobLike = (value) => value != null && typeof value === "object" && typeof value.size === "number" && typeof value.type === "string" && typeof value.text === "function" && typeof value.slice === "function" && typeof value.arrayBuffer === "function";
async function toFile(value, name, options) {
  value = await value;
  if (isFileLike(value)) {
    return value;
  }
  if (isResponseLike(value)) {
    const blob = await value.blob();
    name || (name = new URL(value.url).pathname.split(/[\\/]/).pop() ?? "unknown_file");
    const data = isBlobLike(blob) ? [await blob.arrayBuffer()] : [blob];
    return new File2(data, name, options);
  }
  const bits = await getBytes(value);
  name || (name = getName(value) ?? "unknown_file");
  if (!options?.type) {
    const type = bits[0]?.type;
    if (typeof type === "string") {
      options = { ...options, type };
    }
  }
  return new File2(bits, name, options);
}
async function getBytes(value) {
  let parts = [];
  if (typeof value === "string" || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    parts.push(value);
  } else if (isBlobLike(value)) {
    parts.push(await value.arrayBuffer());
  } else if (isAsyncIterableIterator(value)) {
    for await (const chunk of value) {
      parts.push(chunk);
    }
  } else {
    throw new Error(`Unexpected data type: ${typeof value}; constructor: ${value?.constructor?.name}; props: ${propsForError(value)}`);
  }
  return parts;
}
function propsForError(value) {
  const props = Object.getOwnPropertyNames(value);
  return `[${props.map((p) => `"${p}"`).join(", ")}]`;
}
function getName(value) {
  return getStringFromMaybeBuffer(value.name) || getStringFromMaybeBuffer(value.filename) || getStringFromMaybeBuffer(value.path)?.split(/[\\/]/).pop();
}
var getStringFromMaybeBuffer = (x) => {
  if (typeof x === "string")
    return x;
  if (typeof Buffer !== "undefined" && x instanceof Buffer)
    return String(x);
  return;
};
var isAsyncIterableIterator = (value) => value != null && typeof value === "object" && typeof value[Symbol.asyncIterator] === "function";
var isMultipartBody = (body) => body && typeof body === "object" && body.body && body[Symbol.toStringTag] === "MultipartBody";

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/core.mjs
var __classPrivateFieldSet = function(receiver, state, value, kind2, f) {
  if (kind2 === "m")
    throw new TypeError("Private method is not writable");
  if (kind2 === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind2 === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet = function(receiver, state, kind2, f) {
  if (kind2 === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind2 === "m" ? f : kind2 === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _AbstractPage_client;
async function defaultParseResponse(props) {
  const { response } = props;
  if (props.options.stream) {
    debug("response", response.status, response.url, response.headers, response.body);
    if (props.options.__streamClass) {
      return props.options.__streamClass.fromSSEResponse(response, props.controller);
    }
    return Stream.fromSSEResponse(response, props.controller);
  }
  if (response.status === 204) {
    return null;
  }
  if (props.options.__binaryResponse) {
    return response;
  }
  const contentType = response.headers.get("content-type");
  const isJSON = contentType?.includes("application/json") || contentType?.includes("application/vnd.api+json");
  if (isJSON) {
    const json = await response.json();
    debug("response", response.status, response.url, response.headers, json);
    return json;
  }
  const text = await response.text();
  debug("response", response.status, response.url, response.headers, text);
  return text;
}

class APIPromise extends Promise {
  constructor(responsePromise, parseResponse6 = defaultParseResponse) {
    super((resolve3) => {
      resolve3(null);
    });
    this.responsePromise = responsePromise;
    this.parseResponse = parseResponse6;
  }
  _thenUnwrap(transform) {
    return new APIPromise(this.responsePromise, async (props) => transform(await this.parseResponse(props), props));
  }
  asResponse() {
    return this.responsePromise.then((p) => p.response);
  }
  async withResponse() {
    const [data, response] = await Promise.all([this.parse(), this.asResponse()]);
    return { data, response };
  }
  parse() {
    if (!this.parsedPromise) {
      this.parsedPromise = this.responsePromise.then(this.parseResponse);
    }
    return this.parsedPromise;
  }
  then(onfulfilled, onrejected) {
    return this.parse().then(onfulfilled, onrejected);
  }
  catch(onrejected) {
    return this.parse().catch(onrejected);
  }
  finally(onfinally) {
    return this.parse().finally(onfinally);
  }
}

class APIClient {
  constructor({
    baseURL,
    maxRetries = 2,
    timeout = 600000,
    httpAgent,
    fetch: overridenFetch
  }) {
    this.baseURL = baseURL;
    this.maxRetries = validatePositiveInteger("maxRetries", maxRetries);
    this.timeout = validatePositiveInteger("timeout", timeout);
    this.httpAgent = httpAgent;
    this.fetch = overridenFetch ?? fetch2;
  }
  authHeaders(opts) {
    return {};
  }
  defaultHeaders(opts) {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": this.getUserAgent(),
      ...getPlatformHeaders(),
      ...this.authHeaders(opts)
    };
  }
  validateHeaders(headers, customHeaders) {}
  defaultIdempotencyKey() {
    return `stainless-node-retry-${uuid4()}`;
  }
  get(path, opts) {
    return this.methodRequest("get", path, opts);
  }
  post(path, opts) {
    return this.methodRequest("post", path, opts);
  }
  patch(path, opts) {
    return this.methodRequest("patch", path, opts);
  }
  put(path, opts) {
    return this.methodRequest("put", path, opts);
  }
  delete(path, opts) {
    return this.methodRequest("delete", path, opts);
  }
  methodRequest(method, path, opts) {
    return this.request(Promise.resolve(opts).then(async (opts2) => {
      const body = opts2 && isBlobLike(opts2?.body) ? new DataView(await opts2.body.arrayBuffer()) : opts2?.body instanceof DataView ? opts2.body : opts2?.body instanceof ArrayBuffer ? new DataView(opts2.body) : opts2 && ArrayBuffer.isView(opts2?.body) ? new DataView(opts2.body.buffer) : opts2?.body;
      return { method, path, ...opts2, body };
    }));
  }
  getAPIList(path, Page, opts) {
    return this.requestAPIList(Page, { method: "get", path, ...opts });
  }
  calculateContentLength(body) {
    if (typeof body === "string") {
      if (typeof Buffer !== "undefined") {
        return Buffer.byteLength(body, "utf8").toString();
      }
      if (typeof TextEncoder !== "undefined") {
        const encoder = new TextEncoder;
        const encoded = encoder.encode(body);
        return encoded.length.toString();
      }
    } else if (ArrayBuffer.isView(body)) {
      return body.byteLength.toString();
    }
    return null;
  }
  buildRequest(options, { retryCount = 0 } = {}) {
    const { method, path, query, headers = {} } = options;
    const body = ArrayBuffer.isView(options.body) || options.__binaryRequest && typeof options.body === "string" ? options.body : isMultipartBody(options.body) ? options.body.body : options.body ? JSON.stringify(options.body, null, 2) : null;
    const contentLength = this.calculateContentLength(body);
    const url = this.buildURL(path, query);
    if ("timeout" in options)
      validatePositiveInteger("timeout", options.timeout);
    const timeout = options.timeout ?? this.timeout;
    const httpAgent = options.httpAgent ?? this.httpAgent ?? getDefaultAgent(url);
    const minAgentTimeout = timeout + 1000;
    if (typeof httpAgent?.options?.timeout === "number" && minAgentTimeout > (httpAgent.options.timeout ?? 0)) {
      httpAgent.options.timeout = minAgentTimeout;
    }
    if (this.idempotencyHeader && method !== "get") {
      if (!options.idempotencyKey)
        options.idempotencyKey = this.defaultIdempotencyKey();
      headers[this.idempotencyHeader] = options.idempotencyKey;
    }
    const reqHeaders = this.buildHeaders({ options, headers, contentLength, retryCount });
    const req = {
      method,
      ...body && { body },
      headers: reqHeaders,
      ...httpAgent && { agent: httpAgent },
      signal: options.signal ?? null
    };
    return { req, url, timeout };
  }
  buildHeaders({ options, headers, contentLength, retryCount }) {
    const reqHeaders = {};
    if (contentLength) {
      reqHeaders["content-length"] = contentLength;
    }
    const defaultHeaders = this.defaultHeaders(options);
    applyHeadersMut(reqHeaders, defaultHeaders);
    applyHeadersMut(reqHeaders, headers);
    if (isMultipartBody(options.body) && kind !== "node") {
      delete reqHeaders["content-type"];
    }
    if (getHeader(defaultHeaders, "x-stainless-retry-count") === undefined && getHeader(headers, "x-stainless-retry-count") === undefined) {
      reqHeaders["x-stainless-retry-count"] = String(retryCount);
    }
    this.validateHeaders(reqHeaders, headers);
    return reqHeaders;
  }
  async prepareOptions(options) {}
  async prepareRequest(request, { url, options }) {}
  parseHeaders(headers) {
    return !headers ? {} : (Symbol.iterator in headers) ? Object.fromEntries(Array.from(headers).map((header) => [...header])) : { ...headers };
  }
  makeStatusError(status, error, message, headers) {
    return APIError.generate(status, error, message, headers);
  }
  request(options, remainingRetries = null) {
    return new APIPromise(this.makeRequest(options, remainingRetries));
  }
  async makeRequest(optionsInput, retriesRemaining) {
    const options = await optionsInput;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    if (retriesRemaining == null) {
      retriesRemaining = maxRetries;
    }
    await this.prepareOptions(options);
    const { req, url, timeout } = this.buildRequest(options, { retryCount: maxRetries - retriesRemaining });
    await this.prepareRequest(req, { url, options });
    debug("request", url, options, req.headers);
    if (options.signal?.aborted) {
      throw new APIUserAbortError;
    }
    const controller = new AbortController;
    const response = await this.fetchWithTimeout(url, req, timeout, controller).catch(castToError);
    if (response instanceof Error) {
      if (options.signal?.aborted) {
        throw new APIUserAbortError;
      }
      if (retriesRemaining) {
        return this.retryRequest(options, retriesRemaining);
      }
      if (response.name === "AbortError") {
        throw new APIConnectionTimeoutError;
      }
      throw new APIConnectionError({ cause: response });
    }
    const responseHeaders = createResponseHeaders(response.headers);
    if (!response.ok) {
      if (retriesRemaining && this.shouldRetry(response)) {
        const retryMessage2 = `retrying, ${retriesRemaining} attempts remaining`;
        debug(`response (error; ${retryMessage2})`, response.status, url, responseHeaders);
        return this.retryRequest(options, retriesRemaining, responseHeaders);
      }
      const errText = await response.text().catch((e) => castToError(e).message);
      const errJSON = safeJSON(errText);
      const errMessage = errJSON ? undefined : errText;
      const retryMessage = retriesRemaining ? `(error; no more retries left)` : `(error; not retryable)`;
      debug(`response (error; ${retryMessage})`, response.status, url, responseHeaders, errMessage);
      const err = this.makeStatusError(response.status, errJSON, errMessage, responseHeaders);
      throw err;
    }
    return { response, options, controller };
  }
  requestAPIList(Page, options) {
    const request = this.makeRequest(options, null);
    return new PagePromise(this, request, Page);
  }
  buildURL(path, query) {
    const url = isAbsoluteURL(path) ? new URL(path) : new URL(this.baseURL + (this.baseURL.endsWith("/") && path.startsWith("/") ? path.slice(1) : path));
    const defaultQuery = this.defaultQuery();
    if (!isEmptyObj(defaultQuery)) {
      query = { ...defaultQuery, ...query };
    }
    if (typeof query === "object" && query && !Array.isArray(query)) {
      url.search = this.stringifyQuery(query);
    }
    return url.toString();
  }
  stringifyQuery(query) {
    return Object.entries(query).filter(([_, value]) => typeof value !== "undefined").map(([key, value]) => {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
      }
      if (value === null) {
        return `${encodeURIComponent(key)}=`;
      }
      throw new AnthropicError(`Cannot stringify type ${typeof value}; Expected string, number, boolean, or null. If you need to pass nested query parameters, you can manually encode them, e.g. { query: { 'foo[key1]': value1, 'foo[key2]': value2 } }, and please open a GitHub issue requesting better support for your use case.`);
    }).join("&");
  }
  async fetchWithTimeout(url, init, ms, controller) {
    const { signal, ...options } = init || {};
    if (signal)
      signal.addEventListener("abort", () => controller.abort());
    const timeout = setTimeout(() => controller.abort(), ms);
    return this.getRequestClient().fetch.call(undefined, url, { signal: controller.signal, ...options }).finally(() => {
      clearTimeout(timeout);
    });
  }
  getRequestClient() {
    return { fetch: this.fetch };
  }
  shouldRetry(response) {
    const shouldRetryHeader = response.headers.get("x-should-retry");
    if (shouldRetryHeader === "true")
      return true;
    if (shouldRetryHeader === "false")
      return false;
    if (response.status === 408)
      return true;
    if (response.status === 409)
      return true;
    if (response.status === 429)
      return true;
    if (response.status >= 500)
      return true;
    return false;
  }
  async retryRequest(options, retriesRemaining, responseHeaders) {
    let timeoutMillis;
    const retryAfterMillisHeader = responseHeaders?.["retry-after-ms"];
    if (retryAfterMillisHeader) {
      const timeoutMs = parseFloat(retryAfterMillisHeader);
      if (!Number.isNaN(timeoutMs)) {
        timeoutMillis = timeoutMs;
      }
    }
    const retryAfterHeader = responseHeaders?.["retry-after"];
    if (retryAfterHeader && !timeoutMillis) {
      const timeoutSeconds = parseFloat(retryAfterHeader);
      if (!Number.isNaN(timeoutSeconds)) {
        timeoutMillis = timeoutSeconds * 1000;
      } else {
        timeoutMillis = Date.parse(retryAfterHeader) - Date.now();
      }
    }
    if (!(timeoutMillis && 0 <= timeoutMillis && timeoutMillis < 60 * 1000)) {
      const maxRetries = options.maxRetries ?? this.maxRetries;
      timeoutMillis = this.calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries);
    }
    await sleep(timeoutMillis);
    return this.makeRequest(options, retriesRemaining - 1);
  }
  calculateDefaultRetryTimeoutMillis(retriesRemaining, maxRetries) {
    const initialRetryDelay = 0.5;
    const maxRetryDelay = 8;
    const numRetries = maxRetries - retriesRemaining;
    const sleepSeconds = Math.min(initialRetryDelay * Math.pow(2, numRetries), maxRetryDelay);
    const jitter = 1 - Math.random() * 0.25;
    return sleepSeconds * jitter * 1000;
  }
  getUserAgent() {
    return `${this.constructor.name}/JS ${VERSION}`;
  }
}

class AbstractPage {
  constructor(client, response, body, options) {
    _AbstractPage_client.set(this, undefined);
    __classPrivateFieldSet(this, _AbstractPage_client, client, "f");
    this.options = options;
    this.response = response;
    this.body = body;
  }
  hasNextPage() {
    const items = this.getPaginatedItems();
    if (!items.length)
      return false;
    return this.nextPageInfo() != null;
  }
  async getNextPage() {
    const nextInfo = this.nextPageInfo();
    if (!nextInfo) {
      throw new AnthropicError("No next page expected; please check `.hasNextPage()` before calling `.getNextPage()`.");
    }
    const nextOptions = { ...this.options };
    if ("params" in nextInfo && typeof nextOptions.query === "object") {
      nextOptions.query = { ...nextOptions.query, ...nextInfo.params };
    } else if ("url" in nextInfo) {
      const params = [...Object.entries(nextOptions.query || {}), ...nextInfo.url.searchParams.entries()];
      for (const [key, value] of params) {
        nextInfo.url.searchParams.set(key, value);
      }
      nextOptions.query = undefined;
      nextOptions.path = nextInfo.url.toString();
    }
    return await __classPrivateFieldGet(this, _AbstractPage_client, "f").requestAPIList(this.constructor, nextOptions);
  }
  async* iterPages() {
    let page = this;
    yield page;
    while (page.hasNextPage()) {
      page = await page.getNextPage();
      yield page;
    }
  }
  async* [(_AbstractPage_client = new WeakMap, Symbol.asyncIterator)]() {
    for await (const page of this.iterPages()) {
      for (const item of page.getPaginatedItems()) {
        yield item;
      }
    }
  }
}

class PagePromise extends APIPromise {
  constructor(client, request, Page) {
    super(request, async (props) => new Page(client, props.response, await defaultParseResponse(props), props.options));
  }
  async* [Symbol.asyncIterator]() {
    const page = await this;
    for await (const item of page) {
      yield item;
    }
  }
}
var createResponseHeaders = (headers) => {
  return new Proxy(Object.fromEntries(headers.entries()), {
    get(target, name) {
      const key = name.toString();
      return target[key.toLowerCase()] || target[key];
    }
  });
};
var requestOptionsKeys = {
  method: true,
  path: true,
  query: true,
  body: true,
  headers: true,
  maxRetries: true,
  stream: true,
  timeout: true,
  httpAgent: true,
  signal: true,
  idempotencyKey: true,
  __binaryRequest: true,
  __binaryResponse: true,
  __streamClass: true
};
var isRequestOptions = (obj) => {
  return typeof obj === "object" && obj !== null && !isEmptyObj(obj) && Object.keys(obj).every((k) => hasOwn(requestOptionsKeys, k));
};
var getPlatformProperties = () => {
  if (typeof Deno !== "undefined" && Deno.build != null) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(Deno.build.os),
      "X-Stainless-Arch": normalizeArch(Deno.build.arch),
      "X-Stainless-Runtime": "deno",
      "X-Stainless-Runtime-Version": typeof Deno.version === "string" ? Deno.version : Deno.version?.deno ?? "unknown"
    };
  }
  if (typeof EdgeRuntime !== "undefined") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": `other:${EdgeRuntime}`,
      "X-Stainless-Runtime": "edge",
      "X-Stainless-Runtime-Version": process.version
    };
  }
  if (Object.prototype.toString.call(typeof process !== "undefined" ? process : 0) === "[object process]") {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": normalizePlatform(process.platform),
      "X-Stainless-Arch": normalizeArch(process.arch),
      "X-Stainless-Runtime": "node",
      "X-Stainless-Runtime-Version": process.version
    };
  }
  const browserInfo = getBrowserInfo();
  if (browserInfo) {
    return {
      "X-Stainless-Lang": "js",
      "X-Stainless-Package-Version": VERSION,
      "X-Stainless-OS": "Unknown",
      "X-Stainless-Arch": "unknown",
      "X-Stainless-Runtime": `browser:${browserInfo.browser}`,
      "X-Stainless-Runtime-Version": browserInfo.version
    };
  }
  return {
    "X-Stainless-Lang": "js",
    "X-Stainless-Package-Version": VERSION,
    "X-Stainless-OS": "Unknown",
    "X-Stainless-Arch": "unknown",
    "X-Stainless-Runtime": "unknown",
    "X-Stainless-Runtime-Version": "unknown"
  };
};
function getBrowserInfo() {
  if (typeof navigator === "undefined" || !navigator) {
    return null;
  }
  const browserPatterns = [
    { key: "edge", pattern: /Edge(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /MSIE(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "ie", pattern: /Trident(?:.*rv\:(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "chrome", pattern: /Chrome(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "firefox", pattern: /Firefox(?:\W+(\d+)\.(\d+)(?:\.(\d+))?)?/ },
    { key: "safari", pattern: /(?:Version\W+(\d+)\.(\d+)(?:\.(\d+))?)?(?:\W+Mobile\S*)?\W+Safari/ }
  ];
  for (const { key, pattern } of browserPatterns) {
    const match = pattern.exec(navigator.userAgent);
    if (match) {
      const major = match[1] || 0;
      const minor = match[2] || 0;
      const patch = match[3] || 0;
      return { browser: key, version: `${major}.${minor}.${patch}` };
    }
  }
  return null;
}
var normalizeArch = (arch) => {
  if (arch === "x32")
    return "x32";
  if (arch === "x86_64" || arch === "x64")
    return "x64";
  if (arch === "arm")
    return "arm";
  if (arch === "aarch64" || arch === "arm64")
    return "arm64";
  if (arch)
    return `other:${arch}`;
  return "unknown";
};
var normalizePlatform = (platform) => {
  platform = platform.toLowerCase();
  if (platform.includes("ios"))
    return "iOS";
  if (platform === "android")
    return "Android";
  if (platform === "darwin")
    return "MacOS";
  if (platform === "win32")
    return "Windows";
  if (platform === "freebsd")
    return "FreeBSD";
  if (platform === "openbsd")
    return "OpenBSD";
  if (platform === "linux")
    return "Linux";
  if (platform)
    return `Other:${platform}`;
  return "Unknown";
};
var _platformHeaders;
var getPlatformHeaders = () => {
  return _platformHeaders ?? (_platformHeaders = getPlatformProperties());
};
var safeJSON = (text) => {
  try {
    return JSON.parse(text);
  } catch (err) {
    return;
  }
};
var startsWithSchemeRegexp = new RegExp("^(?:[a-z]+:)?//", "i");
var isAbsoluteURL = (url) => {
  return startsWithSchemeRegexp.test(url);
};
var sleep = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
var validatePositiveInteger = (name, n) => {
  if (typeof n !== "number" || !Number.isInteger(n)) {
    throw new AnthropicError(`${name} must be an integer`);
  }
  if (n < 0) {
    throw new AnthropicError(`${name} must be a positive integer`);
  }
  return n;
};
var castToError = (err) => {
  if (err instanceof Error)
    return err;
  if (typeof err === "object" && err !== null) {
    try {
      return new Error(JSON.stringify(err));
    } catch {}
  }
  return new Error(String(err));
};
var readEnv = (env) => {
  if (typeof process !== "undefined") {
    return process.env?.[env]?.trim() ?? undefined;
  }
  if (typeof Deno !== "undefined") {
    return Deno.env?.get?.(env)?.trim();
  }
  return;
};
function isEmptyObj(obj) {
  if (!obj)
    return true;
  for (const _k in obj)
    return false;
  return true;
}
function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
function applyHeadersMut(targetHeaders, newHeaders) {
  for (const k in newHeaders) {
    if (!hasOwn(newHeaders, k))
      continue;
    const lowerKey = k.toLowerCase();
    if (!lowerKey)
      continue;
    const val = newHeaders[k];
    if (val === null) {
      delete targetHeaders[lowerKey];
    } else if (val !== undefined) {
      targetHeaders[lowerKey] = val;
    }
  }
}
function debug(action, ...args) {
  if (typeof process !== "undefined" && process?.env?.["DEBUG"] === "true") {
    console.log(`Anthropic:DEBUG:${action}`, ...args);
  }
}
var uuid4 = () => {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === "x" ? r : r & 3 | 8;
    return v.toString(16);
  });
};
var isRunningInBrowser = () => {
  return typeof window !== "undefined" && typeof window.document !== "undefined" && typeof navigator !== "undefined";
};
var isHeadersProtocol = (headers) => {
  return typeof headers?.get === "function";
};
var getHeader = (headers, header) => {
  const lowerCasedHeader = header.toLowerCase();
  if (isHeadersProtocol(headers)) {
    const intercapsHeader = header[0]?.toUpperCase() + header.substring(1).replace(/([^\w])(\w)/g, (_m, g1, g2) => g1 + g2.toUpperCase());
    for (const key of [header, lowerCasedHeader, header.toUpperCase(), intercapsHeader]) {
      const value = headers.get(key);
      if (value) {
        return value;
      }
    }
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerCasedHeader) {
      if (Array.isArray(value)) {
        if (value.length <= 1)
          return value[0];
        console.warn(`Received ${value.length} entries for the ${header} header, using the first entry.`);
        return value[0];
      }
      return value;
    }
  }
  return;
};

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/pagination.mjs
class Page extends AbstractPage {
  constructor(client, response, body, options) {
    super(client, response, body, options);
    this.data = body.data || [];
    this.has_more = body.has_more || false;
    this.first_id = body.first_id || null;
    this.last_id = body.last_id || null;
  }
  getPaginatedItems() {
    return this.data ?? [];
  }
  nextPageParams() {
    const info = this.nextPageInfo();
    if (!info)
      return null;
    if ("params" in info)
      return info.params;
    const params = Object.fromEntries(info.url.searchParams);
    if (!Object.keys(params).length)
      return null;
    return params;
  }
  nextPageInfo() {
    if (this.options.query?.["before_id"]) {
      const firstId = this.first_id;
      if (!firstId) {
        return null;
      }
      return {
        params: {
          before_id: firstId
        }
      };
    }
    const cursor = this.last_id;
    if (!cursor) {
      return null;
    }
    return {
      params: {
        after_id: cursor
      }
    };
  }
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resource.mjs
class APIResource {
  constructor(client) {
    this._client = client;
  }
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/internal/decoders/jsonl.mjs
class JSONLDecoder {
  constructor(iterator, controller) {
    this.iterator = iterator;
    this.controller = controller;
  }
  async* decoder() {
    const lineDecoder = new LineDecoder;
    for await (const chunk of this.iterator) {
      for (const line of lineDecoder.decode(chunk)) {
        yield JSON.parse(line);
      }
    }
    for (const line of lineDecoder.flush()) {
      yield JSON.parse(line);
    }
  }
  [Symbol.asyncIterator]() {
    return this.decoder();
  }
  static fromResponse(response, controller) {
    if (!response.body) {
      controller.abort();
      throw new AnthropicError(`Attempted to iterate over a response with no body`);
    }
    return new JSONLDecoder(readableStreamAsyncIterable(response.body), controller);
  }
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resources/beta/messages/batches.mjs
class Batches extends APIResource {
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/messages/batches?beta=true", {
      body,
      ...options,
      headers: {
        "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString(),
        ...options?.headers
      }
    });
  }
  retrieve(messageBatchId, params = {}, options) {
    if (isRequestOptions(params)) {
      return this.retrieve(messageBatchId, {}, params);
    }
    const { betas } = params;
    return this._client.get(`/v1/messages/batches/${messageBatchId}?beta=true`, {
      ...options,
      headers: {
        "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString(),
        ...options?.headers
      }
    });
  }
  list(params = {}, options) {
    if (isRequestOptions(params)) {
      return this.list({}, params);
    }
    const { betas, ...query } = params;
    return this._client.getAPIList("/v1/messages/batches?beta=true", BetaMessageBatchesPage, {
      query,
      ...options,
      headers: {
        "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString(),
        ...options?.headers
      }
    });
  }
  cancel(messageBatchId, params = {}, options) {
    if (isRequestOptions(params)) {
      return this.cancel(messageBatchId, {}, params);
    }
    const { betas } = params;
    return this._client.post(`/v1/messages/batches/${messageBatchId}/cancel?beta=true`, {
      ...options,
      headers: {
        "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString(),
        ...options?.headers
      }
    });
  }
  async results(messageBatchId, params = {}, options) {
    if (isRequestOptions(params)) {
      return this.results(messageBatchId, {}, params);
    }
    const batch = await this.retrieve(messageBatchId);
    if (!batch.results_url) {
      throw new AnthropicError(`No batch \`results_url\`; Has it finished processing? ${batch.processing_status} - ${batch.id}`);
    }
    const { betas } = params;
    return this._client.get(batch.results_url, {
      ...options,
      headers: {
        "anthropic-beta": [...betas ?? [], "message-batches-2024-09-24"].toString(),
        ...options?.headers
      },
      __binaryResponse: true
    })._thenUnwrap((_, props) => JSONLDecoder.fromResponse(props.response, props.controller));
  }
}

class BetaMessageBatchesPage extends Page {
}
Batches.BetaMessageBatchesPage = BetaMessageBatchesPage;

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resources/beta/messages/messages.mjs
class Messages extends APIResource {
  constructor() {
    super(...arguments);
    this.batches = new Batches(this._client);
  }
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/messages?beta=true", {
      body,
      timeout: this._client._options.timeout ?? 600000,
      ...options,
      headers: {
        ...betas?.toString() != null ? { "anthropic-beta": betas?.toString() } : undefined,
        ...options?.headers
      },
      stream: params.stream ?? false
    });
  }
  countTokens(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/messages/count_tokens?beta=true", {
      body,
      ...options,
      headers: {
        "anthropic-beta": [...betas ?? [], "token-counting-2024-11-01"].toString(),
        ...options?.headers
      }
    });
  }
}
Messages.Batches = Batches;
Messages.BetaMessageBatchesPage = BetaMessageBatchesPage;

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/_vendor/partial-json-parser/parser.mjs
var tokenize = (input) => {
  let current = 0;
  let tokens = [];
  while (current < input.length) {
    let char = input[current];
    if (char === "\\") {
      current++;
      continue;
    }
    if (char === "{") {
      tokens.push({
        type: "brace",
        value: "{"
      });
      current++;
      continue;
    }
    if (char === "}") {
      tokens.push({
        type: "brace",
        value: "}"
      });
      current++;
      continue;
    }
    if (char === "[") {
      tokens.push({
        type: "paren",
        value: "["
      });
      current++;
      continue;
    }
    if (char === "]") {
      tokens.push({
        type: "paren",
        value: "]"
      });
      current++;
      continue;
    }
    if (char === ":") {
      tokens.push({
        type: "separator",
        value: ":"
      });
      current++;
      continue;
    }
    if (char === ",") {
      tokens.push({
        type: "delimiter",
        value: ","
      });
      current++;
      continue;
    }
    if (char === '"') {
      let value = "";
      let danglingQuote = false;
      char = input[++current];
      while (char !== '"') {
        if (current === input.length) {
          danglingQuote = true;
          break;
        }
        if (char === "\\") {
          current++;
          if (current === input.length) {
            danglingQuote = true;
            break;
          }
          value += char + input[current];
          char = input[++current];
        } else {
          value += char;
          char = input[++current];
        }
      }
      char = input[++current];
      if (!danglingQuote) {
        tokens.push({
          type: "string",
          value
        });
      }
      continue;
    }
    let WHITESPACE = /\s/;
    if (char && WHITESPACE.test(char)) {
      current++;
      continue;
    }
    let NUMBERS = /[0-9]/;
    if (char && NUMBERS.test(char) || char === "-" || char === ".") {
      let value = "";
      if (char === "-") {
        value += char;
        char = input[++current];
      }
      while (char && NUMBERS.test(char) || char === ".") {
        value += char;
        char = input[++current];
      }
      tokens.push({
        type: "number",
        value
      });
      continue;
    }
    let LETTERS = /[a-z]/i;
    if (char && LETTERS.test(char)) {
      let value = "";
      while (char && LETTERS.test(char)) {
        if (current === input.length) {
          break;
        }
        value += char;
        char = input[++current];
      }
      if (value == "true" || value == "false" || value === "null") {
        tokens.push({
          type: "name",
          value
        });
      } else {
        current++;
        continue;
      }
      continue;
    }
    current++;
  }
  return tokens;
};
var strip = (tokens) => {
  if (tokens.length === 0) {
    return tokens;
  }
  let lastToken = tokens[tokens.length - 1];
  switch (lastToken.type) {
    case "separator":
      tokens = tokens.slice(0, tokens.length - 1);
      return strip(tokens);
      break;
    case "number":
      let lastCharacterOfLastToken = lastToken.value[lastToken.value.length - 1];
      if (lastCharacterOfLastToken === "." || lastCharacterOfLastToken === "-") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      }
    case "string":
      let tokenBeforeTheLastToken = tokens[tokens.length - 2];
      if (tokenBeforeTheLastToken?.type === "delimiter") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      } else if (tokenBeforeTheLastToken?.type === "brace" && tokenBeforeTheLastToken.value === "{") {
        tokens = tokens.slice(0, tokens.length - 1);
        return strip(tokens);
      }
      break;
    case "delimiter":
      tokens = tokens.slice(0, tokens.length - 1);
      return strip(tokens);
      break;
  }
  return tokens;
};
var unstrip = (tokens) => {
  let tail = [];
  tokens.map((token) => {
    if (token.type === "brace") {
      if (token.value === "{") {
        tail.push("}");
      } else {
        tail.splice(tail.lastIndexOf("}"), 1);
      }
    }
    if (token.type === "paren") {
      if (token.value === "[") {
        tail.push("]");
      } else {
        tail.splice(tail.lastIndexOf("]"), 1);
      }
    }
  });
  if (tail.length > 0) {
    tail.reverse().map((item) => {
      if (item === "}") {
        tokens.push({
          type: "brace",
          value: "}"
        });
      } else if (item === "]") {
        tokens.push({
          type: "paren",
          value: "]"
        });
      }
    });
  }
  return tokens;
};
var generate = (tokens) => {
  let output = "";
  tokens.map((token) => {
    switch (token.type) {
      case "string":
        output += '"' + token.value + '"';
        break;
      default:
        output += token.value;
        break;
    }
  });
  return output;
};
var partialParse = (input) => JSON.parse(generate(unstrip(strip(tokenize(input)))));

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/lib/PromptCachingBetaMessageStream.mjs
var __classPrivateFieldSet2 = function(receiver, state, value, kind2, f) {
  if (kind2 === "m")
    throw new TypeError("Private method is not writable");
  if (kind2 === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind2 === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet2 = function(receiver, state, kind2, f) {
  if (kind2 === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind2 === "m" ? f : kind2 === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _PromptCachingBetaMessageStream_instances;
var _PromptCachingBetaMessageStream_currentMessageSnapshot;
var _PromptCachingBetaMessageStream_connectedPromise;
var _PromptCachingBetaMessageStream_resolveConnectedPromise;
var _PromptCachingBetaMessageStream_rejectConnectedPromise;
var _PromptCachingBetaMessageStream_endPromise;
var _PromptCachingBetaMessageStream_resolveEndPromise;
var _PromptCachingBetaMessageStream_rejectEndPromise;
var _PromptCachingBetaMessageStream_listeners;
var _PromptCachingBetaMessageStream_ended;
var _PromptCachingBetaMessageStream_errored;
var _PromptCachingBetaMessageStream_aborted;
var _PromptCachingBetaMessageStream_catchingPromiseCreated;
var _PromptCachingBetaMessageStream_getFinalMessage;
var _PromptCachingBetaMessageStream_getFinalText;
var _PromptCachingBetaMessageStream_handleError;
var _PromptCachingBetaMessageStream_beginRequest;
var _PromptCachingBetaMessageStream_addStreamEvent;
var _PromptCachingBetaMessageStream_endRequest;
var _PromptCachingBetaMessageStream_accumulateMessage;
var JSON_BUF_PROPERTY = "__json_buf";

class PromptCachingBetaMessageStream {
  constructor() {
    _PromptCachingBetaMessageStream_instances.add(this);
    this.messages = [];
    this.receivedMessages = [];
    _PromptCachingBetaMessageStream_currentMessageSnapshot.set(this, undefined);
    this.controller = new AbortController;
    _PromptCachingBetaMessageStream_connectedPromise.set(this, undefined);
    _PromptCachingBetaMessageStream_resolveConnectedPromise.set(this, () => {});
    _PromptCachingBetaMessageStream_rejectConnectedPromise.set(this, () => {});
    _PromptCachingBetaMessageStream_endPromise.set(this, undefined);
    _PromptCachingBetaMessageStream_resolveEndPromise.set(this, () => {});
    _PromptCachingBetaMessageStream_rejectEndPromise.set(this, () => {});
    _PromptCachingBetaMessageStream_listeners.set(this, {});
    _PromptCachingBetaMessageStream_ended.set(this, false);
    _PromptCachingBetaMessageStream_errored.set(this, false);
    _PromptCachingBetaMessageStream_aborted.set(this, false);
    _PromptCachingBetaMessageStream_catchingPromiseCreated.set(this, false);
    _PromptCachingBetaMessageStream_handleError.set(this, (error) => {
      __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_errored, true, "f");
      if (error instanceof Error && error.name === "AbortError") {
        error = new APIUserAbortError;
      }
      if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_aborted, true, "f");
        return this._emit("abort", error);
      }
      if (error instanceof AnthropicError) {
        return this._emit("error", error);
      }
      if (error instanceof Error) {
        const anthropicError = new AnthropicError(error.message);
        anthropicError.cause = error;
        return this._emit("error", anthropicError);
      }
      return this._emit("error", new AnthropicError(String(error)));
    });
    __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_connectedPromise, new Promise((resolve3, reject) => {
      __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_resolveConnectedPromise, resolve3, "f");
      __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_rejectConnectedPromise, reject, "f");
    }), "f");
    __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_endPromise, new Promise((resolve3, reject) => {
      __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_resolveEndPromise, resolve3, "f");
      __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_rejectEndPromise, reject, "f");
    }), "f");
    __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_connectedPromise, "f").catch(() => {});
    __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_endPromise, "f").catch(() => {});
  }
  static fromReadableStream(stream) {
    const runner = new PromptCachingBetaMessageStream;
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createMessage(messages, params, options) {
    const runner = new PromptCachingBetaMessageStream;
    for (const message of params.messages) {
      runner._addPromptCachingBetaMessageParam(message);
    }
    runner._run(() => runner._createPromptCachingBetaMessage(messages, { ...params, stream: true }, { ...options, headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" } }));
    return runner;
  }
  _run(executor) {
    executor().then(() => {
      this._emitFinal();
      this._emit("end");
    }, __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_handleError, "f"));
  }
  _addPromptCachingBetaMessageParam(message) {
    this.messages.push(message);
  }
  _addPromptCachingBetaMessage(message, emit = true) {
    this.receivedMessages.push(message);
    if (emit) {
      this._emit("message", message);
    }
  }
  async _createPromptCachingBetaMessage(messages, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_beginRequest).call(this);
    const stream = await messages.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_addStreamEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError;
    }
    __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_endRequest).call(this);
  }
  _connected() {
    if (this.ended)
      return;
    __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_resolveConnectedPromise, "f").call(this);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  on(event, listener) {
    const listeners = __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_listeners, "f")[event] || (__classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_listeners, "f")[event] = []);
    listeners.push({ listener });
    return this;
  }
  off(event, listener) {
    const listeners = __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_listeners, "f")[event];
    if (!listeners)
      return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0)
      listeners.splice(index, 1);
    return this;
  }
  once(event, listener) {
    const listeners = __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_listeners, "f")[event] || (__classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_listeners, "f")[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  emitted(event) {
    return new Promise((resolve3, reject) => {
      __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_catchingPromiseCreated, true, "f");
      if (event !== "error")
        this.once("error", reject);
      this.once(event, resolve3);
    });
  }
  async done() {
    __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_catchingPromiseCreated, true, "f");
    await __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_endPromise, "f");
  }
  get currentMessage() {
    return __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_currentMessageSnapshot, "f");
  }
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_getFinalMessage).call(this);
  }
  async finalText() {
    await this.done();
    return __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_getFinalText).call(this);
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_ended, "f"))
      return;
    if (event === "end") {
      __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_ended, true, "f");
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
      listeners.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
    const finalPromptCachingBetaMessage = this.receivedMessages.at(-1);
    if (finalPromptCachingBetaMessage) {
      this._emit("finalPromptCachingBetaMessage", __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_getFinalMessage).call(this));
    }
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_beginRequest).call(this);
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    for await (const event of stream) {
      __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_addStreamEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError;
    }
    __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_endRequest).call(this);
  }
  [(_PromptCachingBetaMessageStream_currentMessageSnapshot = new WeakMap, _PromptCachingBetaMessageStream_connectedPromise = new WeakMap, _PromptCachingBetaMessageStream_resolveConnectedPromise = new WeakMap, _PromptCachingBetaMessageStream_rejectConnectedPromise = new WeakMap, _PromptCachingBetaMessageStream_endPromise = new WeakMap, _PromptCachingBetaMessageStream_resolveEndPromise = new WeakMap, _PromptCachingBetaMessageStream_rejectEndPromise = new WeakMap, _PromptCachingBetaMessageStream_listeners = new WeakMap, _PromptCachingBetaMessageStream_ended = new WeakMap, _PromptCachingBetaMessageStream_errored = new WeakMap, _PromptCachingBetaMessageStream_aborted = new WeakMap, _PromptCachingBetaMessageStream_catchingPromiseCreated = new WeakMap, _PromptCachingBetaMessageStream_handleError = new WeakMap, _PromptCachingBetaMessageStream_instances = new WeakSet, _PromptCachingBetaMessageStream_getFinalMessage = function _PromptCachingBetaMessageStream_getFinalMessage() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a PromptCachingBetaMessage with role=assistant");
    }
    return this.receivedMessages.at(-1);
  }, _PromptCachingBetaMessageStream_getFinalText = function _PromptCachingBetaMessageStream_getFinalText() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a PromptCachingBetaMessage with role=assistant");
    }
    const textBlocks = this.receivedMessages.at(-1).content.filter((block) => block.type === "text").map((block) => block.text);
    if (textBlocks.length === 0) {
      throw new AnthropicError("stream ended without producing a content block with type=text");
    }
    return textBlocks.join(" ");
  }, _PromptCachingBetaMessageStream_beginRequest = function _PromptCachingBetaMessageStream_beginRequest() {
    if (this.ended)
      return;
    __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_currentMessageSnapshot, undefined, "f");
  }, _PromptCachingBetaMessageStream_addStreamEvent = function _PromptCachingBetaMessageStream_addStreamEvent(event) {
    if (this.ended)
      return;
    const messageSnapshot = __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_instances, "m", _PromptCachingBetaMessageStream_accumulateMessage).call(this, event);
    this._emit("streamEvent", event, messageSnapshot);
    switch (event.type) {
      case "content_block_delta": {
        const content = messageSnapshot.content.at(-1);
        if (event.delta.type === "text_delta" && content.type === "text") {
          this._emit("text", event.delta.text, content.text || "");
        } else if (event.delta.type === "input_json_delta" && content.type === "tool_use") {
          if (content.input) {
            this._emit("inputJson", event.delta.partial_json, content.input);
          }
        }
        break;
      }
      case "message_stop": {
        this._addPromptCachingBetaMessageParam(messageSnapshot);
        this._addPromptCachingBetaMessage(messageSnapshot, true);
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", messageSnapshot.content.at(-1));
        break;
      }
      case "message_start": {
        __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_currentMessageSnapshot, messageSnapshot, "f");
        break;
      }
      case "content_block_start":
      case "message_delta":
        break;
    }
  }, _PromptCachingBetaMessageStream_endRequest = function _PromptCachingBetaMessageStream_endRequest() {
    if (this.ended) {
      throw new AnthropicError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_currentMessageSnapshot, "f");
    if (!snapshot) {
      throw new AnthropicError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet2(this, _PromptCachingBetaMessageStream_currentMessageSnapshot, undefined, "f");
    return snapshot;
  }, _PromptCachingBetaMessageStream_accumulateMessage = function _PromptCachingBetaMessageStream_accumulateMessage(event) {
    let snapshot = __classPrivateFieldGet2(this, _PromptCachingBetaMessageStream_currentMessageSnapshot, "f");
    if (event.type === "message_start") {
      if (snapshot) {
        throw new AnthropicError(`Unexpected event order, got ${event.type} before receiving "message_stop"`);
      }
      return event.message;
    }
    if (!snapshot) {
      throw new AnthropicError(`Unexpected event order, got ${event.type} before "message_start"`);
    }
    switch (event.type) {
      case "message_stop":
        return snapshot;
      case "message_delta":
        snapshot.stop_reason = event.delta.stop_reason;
        snapshot.stop_sequence = event.delta.stop_sequence;
        snapshot.usage.output_tokens = event.usage.output_tokens;
        return snapshot;
      case "content_block_start":
        snapshot.content.push(event.content_block);
        return snapshot;
      case "content_block_delta": {
        const snapshotContent = snapshot.content.at(event.index);
        if (snapshotContent?.type === "text" && event.delta.type === "text_delta") {
          snapshotContent.text += event.delta.text;
        } else if (snapshotContent?.type === "tool_use" && event.delta.type === "input_json_delta") {
          let jsonBuf = snapshotContent[JSON_BUF_PROPERTY] || "";
          jsonBuf += event.delta.partial_json;
          Object.defineProperty(snapshotContent, JSON_BUF_PROPERTY, {
            value: jsonBuf,
            enumerable: false,
            writable: true
          });
          if (jsonBuf) {
            snapshotContent.input = partialParse(jsonBuf);
          }
        }
        return snapshot;
      }
      case "content_block_stop":
        return snapshot;
    }
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("streamEvent", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(undefined);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: undefined, done: true };
          }
          return new Promise((resolve3, reject) => readQueue.push({ resolve: resolve3, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: undefined, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: undefined, done: true };
      }
    };
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resources/beta/prompt-caching/messages.mjs
class Messages2 extends APIResource {
  create(params, options) {
    const { betas, ...body } = params;
    return this._client.post("/v1/messages?beta=prompt_caching", {
      body,
      timeout: this._client._options.timeout ?? 600000,
      ...options,
      headers: {
        "anthropic-beta": [...betas ?? [], "prompt-caching-2024-07-31"].toString(),
        ...options?.headers
      },
      stream: params.stream ?? false
    });
  }
  stream(body, options) {
    return PromptCachingBetaMessageStream.createMessage(this, body, options);
  }
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resources/beta/prompt-caching/prompt-caching.mjs
class PromptCaching extends APIResource {
  constructor() {
    super(...arguments);
    this.messages = new Messages2(this._client);
  }
}
PromptCaching.Messages = Messages2;

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resources/beta/beta.mjs
class Beta extends APIResource {
  constructor() {
    super(...arguments);
    this.messages = new Messages(this._client);
    this.promptCaching = new PromptCaching(this._client);
  }
}
Beta.Messages = Messages;
Beta.PromptCaching = PromptCaching;
// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resources/completions.mjs
class Completions extends APIResource {
  create(body, options) {
    return this._client.post("/v1/complete", {
      body,
      timeout: this._client._options.timeout ?? 600000,
      ...options,
      stream: body.stream ?? false
    });
  }
}
// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/lib/MessageStream.mjs
var __classPrivateFieldSet3 = function(receiver, state, value, kind2, f) {
  if (kind2 === "m")
    throw new TypeError("Private method is not writable");
  if (kind2 === "a" && !f)
    throw new TypeError("Private accessor was defined without a setter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot write private member to an object whose class did not declare it");
  return kind2 === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value), value;
};
var __classPrivateFieldGet3 = function(receiver, state, kind2, f) {
  if (kind2 === "a" && !f)
    throw new TypeError("Private accessor was defined without a getter");
  if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver))
    throw new TypeError("Cannot read private member from an object whose class did not declare it");
  return kind2 === "m" ? f : kind2 === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _MessageStream_instances;
var _MessageStream_currentMessageSnapshot;
var _MessageStream_connectedPromise;
var _MessageStream_resolveConnectedPromise;
var _MessageStream_rejectConnectedPromise;
var _MessageStream_endPromise;
var _MessageStream_resolveEndPromise;
var _MessageStream_rejectEndPromise;
var _MessageStream_listeners;
var _MessageStream_ended;
var _MessageStream_errored;
var _MessageStream_aborted;
var _MessageStream_catchingPromiseCreated;
var _MessageStream_getFinalMessage;
var _MessageStream_getFinalText;
var _MessageStream_handleError;
var _MessageStream_beginRequest;
var _MessageStream_addStreamEvent;
var _MessageStream_endRequest;
var _MessageStream_accumulateMessage;
var JSON_BUF_PROPERTY2 = "__json_buf";

class MessageStream {
  constructor() {
    _MessageStream_instances.add(this);
    this.messages = [];
    this.receivedMessages = [];
    _MessageStream_currentMessageSnapshot.set(this, undefined);
    this.controller = new AbortController;
    _MessageStream_connectedPromise.set(this, undefined);
    _MessageStream_resolveConnectedPromise.set(this, () => {});
    _MessageStream_rejectConnectedPromise.set(this, () => {});
    _MessageStream_endPromise.set(this, undefined);
    _MessageStream_resolveEndPromise.set(this, () => {});
    _MessageStream_rejectEndPromise.set(this, () => {});
    _MessageStream_listeners.set(this, {});
    _MessageStream_ended.set(this, false);
    _MessageStream_errored.set(this, false);
    _MessageStream_aborted.set(this, false);
    _MessageStream_catchingPromiseCreated.set(this, false);
    _MessageStream_handleError.set(this, (error) => {
      __classPrivateFieldSet3(this, _MessageStream_errored, true, "f");
      if (error instanceof Error && error.name === "AbortError") {
        error = new APIUserAbortError;
      }
      if (error instanceof APIUserAbortError) {
        __classPrivateFieldSet3(this, _MessageStream_aborted, true, "f");
        return this._emit("abort", error);
      }
      if (error instanceof AnthropicError) {
        return this._emit("error", error);
      }
      if (error instanceof Error) {
        const anthropicError = new AnthropicError(error.message);
        anthropicError.cause = error;
        return this._emit("error", anthropicError);
      }
      return this._emit("error", new AnthropicError(String(error)));
    });
    __classPrivateFieldSet3(this, _MessageStream_connectedPromise, new Promise((resolve3, reject) => {
      __classPrivateFieldSet3(this, _MessageStream_resolveConnectedPromise, resolve3, "f");
      __classPrivateFieldSet3(this, _MessageStream_rejectConnectedPromise, reject, "f");
    }), "f");
    __classPrivateFieldSet3(this, _MessageStream_endPromise, new Promise((resolve3, reject) => {
      __classPrivateFieldSet3(this, _MessageStream_resolveEndPromise, resolve3, "f");
      __classPrivateFieldSet3(this, _MessageStream_rejectEndPromise, reject, "f");
    }), "f");
    __classPrivateFieldGet3(this, _MessageStream_connectedPromise, "f").catch(() => {});
    __classPrivateFieldGet3(this, _MessageStream_endPromise, "f").catch(() => {});
  }
  static fromReadableStream(stream) {
    const runner = new MessageStream;
    runner._run(() => runner._fromReadableStream(stream));
    return runner;
  }
  static createMessage(messages, params, options) {
    const runner = new MessageStream;
    for (const message of params.messages) {
      runner._addMessageParam(message);
    }
    runner._run(() => runner._createMessage(messages, { ...params, stream: true }, { ...options, headers: { ...options?.headers, "X-Stainless-Helper-Method": "stream" } }));
    return runner;
  }
  _run(executor) {
    executor().then(() => {
      this._emitFinal();
      this._emit("end");
    }, __classPrivateFieldGet3(this, _MessageStream_handleError, "f"));
  }
  _addMessageParam(message) {
    this.messages.push(message);
  }
  _addMessage(message, emit = true) {
    this.receivedMessages.push(message);
    if (emit) {
      this._emit("message", message);
    }
  }
  async _createMessage(messages, params, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_beginRequest).call(this);
    const stream = await messages.create({ ...params, stream: true }, { ...options, signal: this.controller.signal });
    this._connected();
    for await (const event of stream) {
      __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_addStreamEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError;
    }
    __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_endRequest).call(this);
  }
  _connected() {
    if (this.ended)
      return;
    __classPrivateFieldGet3(this, _MessageStream_resolveConnectedPromise, "f").call(this);
    this._emit("connect");
  }
  get ended() {
    return __classPrivateFieldGet3(this, _MessageStream_ended, "f");
  }
  get errored() {
    return __classPrivateFieldGet3(this, _MessageStream_errored, "f");
  }
  get aborted() {
    return __classPrivateFieldGet3(this, _MessageStream_aborted, "f");
  }
  abort() {
    this.controller.abort();
  }
  on(event, listener) {
    const listeners = __classPrivateFieldGet3(this, _MessageStream_listeners, "f")[event] || (__classPrivateFieldGet3(this, _MessageStream_listeners, "f")[event] = []);
    listeners.push({ listener });
    return this;
  }
  off(event, listener) {
    const listeners = __classPrivateFieldGet3(this, _MessageStream_listeners, "f")[event];
    if (!listeners)
      return this;
    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0)
      listeners.splice(index, 1);
    return this;
  }
  once(event, listener) {
    const listeners = __classPrivateFieldGet3(this, _MessageStream_listeners, "f")[event] || (__classPrivateFieldGet3(this, _MessageStream_listeners, "f")[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }
  emitted(event) {
    return new Promise((resolve3, reject) => {
      __classPrivateFieldSet3(this, _MessageStream_catchingPromiseCreated, true, "f");
      if (event !== "error")
        this.once("error", reject);
      this.once(event, resolve3);
    });
  }
  async done() {
    __classPrivateFieldSet3(this, _MessageStream_catchingPromiseCreated, true, "f");
    await __classPrivateFieldGet3(this, _MessageStream_endPromise, "f");
  }
  get currentMessage() {
    return __classPrivateFieldGet3(this, _MessageStream_currentMessageSnapshot, "f");
  }
  async finalMessage() {
    await this.done();
    return __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_getFinalMessage).call(this);
  }
  async finalText() {
    await this.done();
    return __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_getFinalText).call(this);
  }
  _emit(event, ...args) {
    if (__classPrivateFieldGet3(this, _MessageStream_ended, "f"))
      return;
    if (event === "end") {
      __classPrivateFieldSet3(this, _MessageStream_ended, true, "f");
      __classPrivateFieldGet3(this, _MessageStream_resolveEndPromise, "f").call(this);
    }
    const listeners = __classPrivateFieldGet3(this, _MessageStream_listeners, "f")[event];
    if (listeners) {
      __classPrivateFieldGet3(this, _MessageStream_listeners, "f")[event] = listeners.filter((l) => !l.once);
      listeners.forEach(({ listener }) => listener(...args));
    }
    if (event === "abort") {
      const error = args[0];
      if (!__classPrivateFieldGet3(this, _MessageStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet3(this, _MessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet3(this, _MessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
      return;
    }
    if (event === "error") {
      const error = args[0];
      if (!__classPrivateFieldGet3(this, _MessageStream_catchingPromiseCreated, "f") && !listeners?.length) {
        Promise.reject(error);
      }
      __classPrivateFieldGet3(this, _MessageStream_rejectConnectedPromise, "f").call(this, error);
      __classPrivateFieldGet3(this, _MessageStream_rejectEndPromise, "f").call(this, error);
      this._emit("end");
    }
  }
  _emitFinal() {
    const finalMessage = this.receivedMessages.at(-1);
    if (finalMessage) {
      this._emit("finalMessage", __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_getFinalMessage).call(this));
    }
  }
  async _fromReadableStream(readableStream, options) {
    const signal = options?.signal;
    if (signal) {
      if (signal.aborted)
        this.controller.abort();
      signal.addEventListener("abort", () => this.controller.abort());
    }
    __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_beginRequest).call(this);
    this._connected();
    const stream = Stream.fromReadableStream(readableStream, this.controller);
    for await (const event of stream) {
      __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_addStreamEvent).call(this, event);
    }
    if (stream.controller.signal?.aborted) {
      throw new APIUserAbortError;
    }
    __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_endRequest).call(this);
  }
  [(_MessageStream_currentMessageSnapshot = new WeakMap, _MessageStream_connectedPromise = new WeakMap, _MessageStream_resolveConnectedPromise = new WeakMap, _MessageStream_rejectConnectedPromise = new WeakMap, _MessageStream_endPromise = new WeakMap, _MessageStream_resolveEndPromise = new WeakMap, _MessageStream_rejectEndPromise = new WeakMap, _MessageStream_listeners = new WeakMap, _MessageStream_ended = new WeakMap, _MessageStream_errored = new WeakMap, _MessageStream_aborted = new WeakMap, _MessageStream_catchingPromiseCreated = new WeakMap, _MessageStream_handleError = new WeakMap, _MessageStream_instances = new WeakSet, _MessageStream_getFinalMessage = function _MessageStream_getFinalMessage() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    return this.receivedMessages.at(-1);
  }, _MessageStream_getFinalText = function _MessageStream_getFinalText() {
    if (this.receivedMessages.length === 0) {
      throw new AnthropicError("stream ended without producing a Message with role=assistant");
    }
    const textBlocks = this.receivedMessages.at(-1).content.filter((block) => block.type === "text").map((block) => block.text);
    if (textBlocks.length === 0) {
      throw new AnthropicError("stream ended without producing a content block with type=text");
    }
    return textBlocks.join(" ");
  }, _MessageStream_beginRequest = function _MessageStream_beginRequest() {
    if (this.ended)
      return;
    __classPrivateFieldSet3(this, _MessageStream_currentMessageSnapshot, undefined, "f");
  }, _MessageStream_addStreamEvent = function _MessageStream_addStreamEvent(event) {
    if (this.ended)
      return;
    const messageSnapshot = __classPrivateFieldGet3(this, _MessageStream_instances, "m", _MessageStream_accumulateMessage).call(this, event);
    this._emit("streamEvent", event, messageSnapshot);
    switch (event.type) {
      case "content_block_delta": {
        const content = messageSnapshot.content.at(-1);
        if (event.delta.type === "text_delta" && content.type === "text") {
          this._emit("text", event.delta.text, content.text || "");
        } else if (event.delta.type === "input_json_delta" && content.type === "tool_use") {
          if (content.input) {
            this._emit("inputJson", event.delta.partial_json, content.input);
          }
        }
        break;
      }
      case "message_stop": {
        this._addMessageParam(messageSnapshot);
        this._addMessage(messageSnapshot, true);
        break;
      }
      case "content_block_stop": {
        this._emit("contentBlock", messageSnapshot.content.at(-1));
        break;
      }
      case "message_start": {
        __classPrivateFieldSet3(this, _MessageStream_currentMessageSnapshot, messageSnapshot, "f");
        break;
      }
      case "content_block_start":
      case "message_delta":
        break;
    }
  }, _MessageStream_endRequest = function _MessageStream_endRequest() {
    if (this.ended) {
      throw new AnthropicError(`stream has ended, this shouldn't happen`);
    }
    const snapshot = __classPrivateFieldGet3(this, _MessageStream_currentMessageSnapshot, "f");
    if (!snapshot) {
      throw new AnthropicError(`request ended without sending any chunks`);
    }
    __classPrivateFieldSet3(this, _MessageStream_currentMessageSnapshot, undefined, "f");
    return snapshot;
  }, _MessageStream_accumulateMessage = function _MessageStream_accumulateMessage(event) {
    let snapshot = __classPrivateFieldGet3(this, _MessageStream_currentMessageSnapshot, "f");
    if (event.type === "message_start") {
      if (snapshot) {
        throw new AnthropicError(`Unexpected event order, got ${event.type} before receiving "message_stop"`);
      }
      return event.message;
    }
    if (!snapshot) {
      throw new AnthropicError(`Unexpected event order, got ${event.type} before "message_start"`);
    }
    switch (event.type) {
      case "message_stop":
        return snapshot;
      case "message_delta":
        snapshot.stop_reason = event.delta.stop_reason;
        snapshot.stop_sequence = event.delta.stop_sequence;
        snapshot.usage.output_tokens = event.usage.output_tokens;
        return snapshot;
      case "content_block_start":
        snapshot.content.push(event.content_block);
        return snapshot;
      case "content_block_delta": {
        const snapshotContent = snapshot.content.at(event.index);
        if (snapshotContent?.type === "text" && event.delta.type === "text_delta") {
          snapshotContent.text += event.delta.text;
        } else if (snapshotContent?.type === "tool_use" && event.delta.type === "input_json_delta") {
          let jsonBuf = snapshotContent[JSON_BUF_PROPERTY2] || "";
          jsonBuf += event.delta.partial_json;
          Object.defineProperty(snapshotContent, JSON_BUF_PROPERTY2, {
            value: jsonBuf,
            enumerable: false,
            writable: true
          });
          if (jsonBuf) {
            snapshotContent.input = partialParse(jsonBuf);
          }
        }
        return snapshot;
      }
      case "content_block_stop":
        return snapshot;
    }
  }, Symbol.asyncIterator)]() {
    const pushQueue = [];
    const readQueue = [];
    let done = false;
    this.on("streamEvent", (event) => {
      const reader = readQueue.shift();
      if (reader) {
        reader.resolve(event);
      } else {
        pushQueue.push(event);
      }
    });
    this.on("end", () => {
      done = true;
      for (const reader of readQueue) {
        reader.resolve(undefined);
      }
      readQueue.length = 0;
    });
    this.on("abort", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    this.on("error", (err) => {
      done = true;
      for (const reader of readQueue) {
        reader.reject(err);
      }
      readQueue.length = 0;
    });
    return {
      next: async () => {
        if (!pushQueue.length) {
          if (done) {
            return { value: undefined, done: true };
          }
          return new Promise((resolve3, reject) => readQueue.push({ resolve: resolve3, reject })).then((chunk2) => chunk2 ? { value: chunk2, done: false } : { value: undefined, done: true });
        }
        const chunk = pushQueue.shift();
        return { value: chunk, done: false };
      },
      return: async () => {
        this.abort();
        return { value: undefined, done: true };
      }
    };
  }
  toReadableStream() {
    const stream = new Stream(this[Symbol.asyncIterator].bind(this), this.controller);
    return stream.toReadableStream();
  }
}

// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/resources/messages.mjs
class Messages3 extends APIResource {
  create(body, options) {
    if (body.model in DEPRECATED_MODELS) {
      console.warn(`The model '${body.model}' is deprecated and will reach end-of-life on ${DEPRECATED_MODELS[body.model]}
Please migrate to a newer model. Visit https://docs.anthropic.com/en/docs/resources/model-deprecations for more information.`);
    }
    return this._client.post("/v1/messages", {
      body,
      timeout: this._client._options.timeout ?? 600000,
      ...options,
      stream: body.stream ?? false
    });
  }
  stream(body, options) {
    return MessageStream.createMessage(this, body, options);
  }
}
var DEPRECATED_MODELS = {
  "claude-1.3": "November 6th, 2024",
  "claude-1.3-100k": "November 6th, 2024",
  "claude-instant-1.1": "November 6th, 2024",
  "claude-instant-1.1-100k": "November 6th, 2024",
  "claude-instant-1.2": "November 6th, 2024"
};
// ../../node_modules/.bun/@anthropic-ai+sdk@0.32.1/node_modules/@anthropic-ai/sdk/index.mjs
var _a;

class Anthropic extends APIClient {
  constructor({ baseURL = readEnv("ANTHROPIC_BASE_URL"), apiKey = readEnv("ANTHROPIC_API_KEY") ?? null, authToken = readEnv("ANTHROPIC_AUTH_TOKEN") ?? null, ...opts } = {}) {
    const options = {
      apiKey,
      authToken,
      ...opts,
      baseURL: baseURL || `https://api.anthropic.com`
    };
    if (!options.dangerouslyAllowBrowser && isRunningInBrowser()) {
      throw new AnthropicError(`It looks like you're running in a browser-like environment.

This is disabled by default, as it risks exposing your secret API credentials to attackers.
If you understand the risks and have appropriate mitigations in place,
you can set the \`dangerouslyAllowBrowser\` option to \`true\`, e.g.,

new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

TODO: link!
`);
    }
    super({
      baseURL: options.baseURL,
      timeout: options.timeout ?? 600000,
      httpAgent: options.httpAgent,
      maxRetries: options.maxRetries,
      fetch: options.fetch
    });
    this.completions = new Completions(this);
    this.messages = new Messages3(this);
    this.beta = new Beta(this);
    this._options = options;
    this.apiKey = apiKey;
    this.authToken = authToken;
  }
  defaultQuery() {
    return this._options.defaultQuery;
  }
  defaultHeaders(opts) {
    return {
      ...super.defaultHeaders(opts),
      ...this._options.dangerouslyAllowBrowser ? { "anthropic-dangerous-direct-browser-access": "true" } : undefined,
      "anthropic-version": "2023-06-01",
      ...this._options.defaultHeaders
    };
  }
  validateHeaders(headers, customHeaders) {
    if (this.apiKey && headers["x-api-key"]) {
      return;
    }
    if (customHeaders["x-api-key"] === null) {
      return;
    }
    if (this.authToken && headers["authorization"]) {
      return;
    }
    if (customHeaders["authorization"] === null) {
      return;
    }
    throw new Error('Could not resolve authentication method. Expected either apiKey or authToken to be set. Or for one of the "X-Api-Key" or "Authorization" headers to be explicitly omitted');
  }
  authHeaders(opts) {
    const apiKeyAuth = this.apiKeyAuth(opts);
    const bearerAuth = this.bearerAuth(opts);
    if (apiKeyAuth != null && !isEmptyObj(apiKeyAuth)) {
      return apiKeyAuth;
    }
    if (bearerAuth != null && !isEmptyObj(bearerAuth)) {
      return bearerAuth;
    }
    return {};
  }
  apiKeyAuth(opts) {
    if (this.apiKey == null) {
      return {};
    }
    return { "X-Api-Key": this.apiKey };
  }
  bearerAuth(opts) {
    if (this.authToken == null) {
      return {};
    }
    return { Authorization: `Bearer ${this.authToken}` };
  }
}
_a = Anthropic;
Anthropic.Anthropic = _a;
Anthropic.HUMAN_PROMPT = `

Human:`;
Anthropic.AI_PROMPT = `

Assistant:`;
Anthropic.DEFAULT_TIMEOUT = 600000;
Anthropic.AnthropicError = AnthropicError;
Anthropic.APIError = APIError;
Anthropic.APIConnectionError = APIConnectionError;
Anthropic.APIConnectionTimeoutError = APIConnectionTimeoutError;
Anthropic.APIUserAbortError = APIUserAbortError;
Anthropic.NotFoundError = NotFoundError;
Anthropic.ConflictError = ConflictError;
Anthropic.RateLimitError = RateLimitError;
Anthropic.BadRequestError = BadRequestError;
Anthropic.AuthenticationError = AuthenticationError;
Anthropic.InternalServerError = InternalServerError;
Anthropic.PermissionDeniedError = PermissionDeniedError;
Anthropic.UnprocessableEntityError = UnprocessableEntityError;
Anthropic.toFile = toFile;
Anthropic.fileFromPath = fileFromPath;
Anthropic.Completions = Completions;
Anthropic.Messages = Messages3;
Anthropic.Beta = Beta;
var sdk_default = Anthropic;

// src/client.ts
var MAX_RETRIES = 3;
var INITIAL_RETRY_DELAY = 1000;
function createClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(`ANTHROPIC_API_KEY environment variable is not set.
` + "Please set it with: export ANTHROPIC_API_KEY='your-api-key'");
  }
  return new sdk_default({
    apiKey
  });
}
function sleep2(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
async function callClaude(systemPrompt, userPrompt, options) {
  const client = createClient();
  let lastError = null;
  for (let attempt = 0;attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt
          }
        ]
      });
      const textContent = response.content.find((block) => block.type === "text");
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text content in API response");
      }
      return textContent.text;
    } catch (error) {
      lastError = error;
      if (error instanceof sdk_default.APIError) {
        if (error.status === 429) {
          const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
          console.warn(`Rate limit hit (429). Retrying in ${retryDelay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
          await sleep2(retryDelay);
          continue;
        }
        if (error.status === 401) {
          throw new Error(`Invalid Anthropic API key (401 Unauthorized)

` + `Your ANTHROPIC_API_KEY is invalid or expired.
` + `Get a new key at: https://console.anthropic.com/settings/keys
` + `Then set it with: export ANTHROPIC_API_KEY='your-new-key'`);
        }
        if (error.status === 429) {
          throw new Error(`Rate limit exceeded (429)

` + `You've hit the API rate limit or quota.
` + `Check your usage at: https://console.anthropic.com/settings/usage
` + `Consider upgrading your plan for higher limits.`);
        }
        throw new Error(`Anthropic API error (${error.status}): ${error.message}
` + `Check the API status: https://status.anthropic.com/`);
      }
      if (lastError.message.includes("fetch") || lastError.message.includes("network")) {
        throw new Error(`Network error: Cannot reach Anthropic API

` + `Please check:
` + `  1. Your internet connection
` + `  2. Firewall or proxy settings
` + `  3. API status: https://status.anthropic.com/`);
      }
      if (attempt < MAX_RETRIES - 1) {
        const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.warn(`API call failed: ${lastError.message}. Retrying in ${retryDelay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`);
        await sleep2(retryDelay);
      }
    }
  }
  throw new Error(`API call failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || "Unknown error"}`);
}
if (false) {}

// src/orchestrator.ts
async function runAgent(agent, files, options) {
  const startTime = Date.now();
  try {
    const userPrompt = agent.userPromptTemplate(files);
    const rawResponse = await callClaude(agent.systemPrompt, userPrompt, {
      model: options.model,
      maxTokens: options.maxTokens || 4096
    });
    const result = agent.parseResponse(rawResponse);
    result.durationMs = Date.now() - startTime;
    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`Agent ${agent.name} failed: ${errorMessage}`);
    return {
      agent: agent.name,
      score: 0,
      findings: [
        {
          severity: "critical",
          title: `Agent ${agent.name} failed`,
          description: `Analysis failed with error: ${errorMessage}`,
          file: "unknown"
        }
      ],
      summary: `Agent failed to complete analysis: ${errorMessage}`,
      durationMs
    };
  }
}
async function runAudit(files, options) {
  console.log(`
Running ${agents.length} agents in parallel...`);
  const startTime = Date.now();
  const results = await Promise.allSettled(agents.map((agent) => runAgent(agent, files, options)));
  const totalDuration = Date.now() - startTime;
  const agentResults = results.map((result, index) => {
    const agent = agents[index];
    if (result.status === "fulfilled") {
      return result.value;
    } else {
      console.error(`Agent ${agent.name} promise rejected: ${result.reason}`);
      return {
        agent: agent.name,
        score: 0,
        findings: [
          {
            severity: "critical",
            title: `Agent ${agent.name} promise rejected`,
            description: `Promise was rejected: ${result.reason}`,
            file: "unknown"
          }
        ],
        summary: `Agent failed: ${result.reason}`,
        durationMs: 0
      };
    }
  });
  console.log(`All agents completed in ${(totalDuration / 1000).toFixed(2)}s`);
  agentResults.forEach((result) => {
    const status = result.score > 0 ? "\u2713" : "\u2717";
    const duration = (result.durationMs / 1000).toFixed(2);
    console.log(`  ${status} ${result.agent.padEnd(15)} - ${duration}s - Score: ${result.score.toFixed(1)}/10 - ${result.findings.length} findings`);
  });
  return agentResults;
}

// src/report/synthesizer.ts
function synthesizeReport(target, agentResults) {
  let weightedSum = 0;
  let totalWeight = 0;
  agentResults.forEach((result) => {
    const agent = agents.find((a) => a.name === result.agent);
    if (agent) {
      weightedSum += result.score * agent.weight;
      totalWeight += agent.weight;
    }
  });
  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  let criticalCount = 0;
  let warningCount = 0;
  let infoCount = 0;
  agentResults.forEach((result) => {
    result.findings.forEach((finding) => {
      switch (finding.severity) {
        case "critical":
          criticalCount++;
          break;
        case "warning":
          warningCount++;
          break;
        case "info":
          infoCount++;
          break;
      }
    });
  });
  const scoredFindings = [];
  agentResults.forEach((result) => {
    result.findings.forEach((finding) => {
      const priority = finding.severity === "critical" ? 3 : finding.severity === "warning" ? 2 : 1;
      scoredFindings.push({
        finding,
        agentName: result.agent,
        priority
      });
    });
  });
  scoredFindings.sort((a, b) => b.priority - a.priority);
  const topRecommendations = scoredFindings.slice(0, 5).map((item) => {
    const { finding, agentName } = item;
    const severityLabel = finding.severity.toUpperCase();
    const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
    let rec = `[${severityLabel}] ${finding.title}
`;
    rec += `  \u2192 ${location}
`;
    if (finding.suggestion) {
      rec += `  ${finding.suggestion}`;
    } else {
      rec += `  ${finding.description}`;
    }
    return rec;
  });
  return {
    target,
    overallScore,
    agentResults,
    criticalCount,
    warningCount,
    infoCount,
    topRecommendations,
    timestamp: new Date().toISOString()
  };
}

// src/report/terminal.ts
var colors = {
  reset: "\x1B[0m",
  bold: "\x1B[1m",
  red: "\x1B[31m",
  green: "\x1B[32m",
  yellow: "\x1B[33m",
  blue: "\x1B[34m",
  cyan: "\x1B[36m",
  gray: "\x1B[90m"
};
function getScoreColor(score) {
  if (score >= 8)
    return colors.green;
  if (score >= 6)
    return colors.yellow;
  return colors.red;
}
function getSeverityColor(severity) {
  switch (severity) {
    case "critical":
      return colors.red;
    case "warning":
      return colors.yellow;
    case "info":
      return colors.blue;
    default:
      return colors.reset;
  }
}
function getStarRating(score) {
  const stars = Math.round(score / 2.5);
  return "\u2B50".repeat(Math.max(0, stars));
}
function formatDuration(ms) {
  if (ms < 1000)
    return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function printReport(report) {
  console.log();
  console.log(colors.bold + colors.cyan + "\u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557" + colors.reset);
  console.log(colors.bold + colors.cyan + "\u2551           AI Code Auditor - Multi-Agent Report           \u2551" + colors.reset);
  console.log(colors.bold + colors.cyan + "\u255A\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255D" + colors.reset);
  console.log();
  console.log(colors.bold + "Target: " + colors.reset + report.target);
  const scoreColor = getScoreColor(report.overallScore);
  const stars = getStarRating(report.overallScore);
  console.log(colors.bold + "Overall Score: " + colors.reset + scoreColor + colors.bold + report.overallScore.toFixed(1) + "/10" + colors.reset + " " + stars);
  console.log();
  console.log(colors.gray + "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501" + colors.reset);
  console.log();
  console.log(colors.bold + "\uD83D\uDCCA Agent Breakdown:" + colors.reset);
  console.log();
  report.agentResults.forEach((result) => {
    const agent = agents.find((a) => a.name === result.agent);
    const weight = agent ? (agent.weight * 100).toFixed(0) : "??";
    const scoreColor2 = getScoreColor(result.score);
    const status = result.score >= 7 ? "\u2713" : "\u26A0";
    const statusColor = result.score >= 7 ? colors.green : colors.yellow;
    console.log(statusColor + status + colors.reset + " " + colors.bold + result.agent.padEnd(15) + colors.reset + scoreColor2 + colors.bold + result.score.toFixed(1) + "/10" + colors.reset + colors.gray + "  (weight: " + weight + "%)" + colors.reset + colors.gray + "  [" + formatDuration(result.durationMs) + "]" + colors.reset);
  });
  console.log();
  console.log(colors.gray + "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501" + colors.reset);
  console.log();
  console.log(colors.bold + "\uD83D\uDD0D Findings Summary:" + colors.reset);
  console.log();
  console.log(colors.red + "\uD83D\uDD34 Critical: " + colors.bold + report.criticalCount + colors.reset);
  console.log(colors.yellow + "\uD83D\uDFE1 Warnings: " + colors.bold + report.warningCount + colors.reset);
  console.log(colors.blue + "\uD83D\uDD35 Info: " + colors.bold + report.infoCount + colors.reset);
  console.log();
  if (report.topRecommendations.length > 0) {
    console.log(colors.gray + "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501" + colors.reset);
    console.log();
    console.log(colors.bold + "\uD83C\uDFAF Top Recommendations:" + colors.reset);
    console.log();
    report.topRecommendations.forEach((rec, index) => {
      const lines = rec.split(`
`);
      const firstLine = lines[0] || "";
      let severityColor = colors.reset;
      if (firstLine.includes("[CRITICAL]")) {
        severityColor = colors.red;
      } else if (firstLine.includes("[WARNING]")) {
        severityColor = colors.yellow;
      } else if (firstLine.includes("[INFO]")) {
        severityColor = colors.blue;
      }
      console.log(colors.bold + `${index + 1}. ` + severityColor + firstLine.replace(/^\[.*?\]\s*/, "") + colors.reset);
      for (let i = 1;i < lines.length; i++) {
        console.log(colors.gray + "   " + lines[i] + colors.reset);
      }
      console.log();
    });
  }
  console.log(colors.gray + "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501" + colors.reset);
  console.log();
  console.log(colors.bold + "\uD83D\uDCCB Detailed Findings:" + colors.reset);
  console.log();
  report.agentResults.forEach((result) => {
    if (result.findings.length === 0) {
      console.log(colors.green + `[${result.agent}] \u2713 No issues found` + colors.reset);
      console.log();
      return;
    }
    console.log(colors.bold + `[${result.agent}]` + colors.reset);
    result.findings.forEach((finding) => {
      const severityColor = getSeverityColor(finding.severity);
      const severityLabel = finding.severity.toUpperCase();
      const icon = finding.severity === "critical" ? "\uD83D\uDD34" : finding.severity === "warning" ? "\uD83D\uDFE1" : "\uD83D\uDD35";
      console.log(severityColor + icon + " " + severityLabel + ": " + colors.bold + finding.title + colors.reset);
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      console.log(colors.gray + "   File: " + location + colors.reset);
      if (finding.description) {
        console.log(colors.gray + "   Description: " + finding.description + colors.reset);
      }
      if (finding.suggestion) {
        console.log(colors.cyan + "   Suggestion: " + finding.suggestion + colors.reset);
      }
      console.log();
    });
  });
  console.log(colors.gray + "\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501" + colors.reset);
  console.log();
}

// src/report/markdown.ts
function getStarRating2(score) {
  const stars = Math.round(score / 2.5);
  return "\u2B50".repeat(Math.max(0, stars));
}
function formatDuration2(ms) {
  if (ms < 1000)
    return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}
function getSeverityEmoji(severity) {
  switch (severity) {
    case "critical":
      return "\uD83D\uDD34";
    case "warning":
      return "\uD83D\uDFE1";
    case "info":
      return "\uD83D\uDD35";
    default:
      return "\u26AA";
  }
}
function getStatusEmoji(score) {
  return score >= 7 ? "\u2713" : "\u26A0\uFE0F";
}
function generateMarkdown(report) {
  const lines = [];
  lines.push("# AI Code Auditor Report");
  lines.push("");
  lines.push(`**Target:** \`${report.target}\``);
  lines.push(`**Date:** ${report.timestamp}`);
  lines.push(`**Overall Score:** ${report.overallScore.toFixed(1)}/10 ${getStarRating2(report.overallScore)}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Agent Breakdown");
  lines.push("");
  lines.push("| Agent | Score | Weight | Duration |");
  lines.push("|-------|-------|--------|----------|");
  report.agentResults.forEach((result) => {
    const agent = agents.find((a) => a.name === result.agent);
    const weight = agent ? `${(agent.weight * 100).toFixed(0)}%` : "??%";
    const status = getStatusEmoji(result.score);
    lines.push(`| ${status} ${result.agent} | ${result.score.toFixed(1)}/10 | ${weight} | ${formatDuration2(result.durationMs)} |`);
  });
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## Findings Summary");
  lines.push("");
  lines.push(`- \uD83D\uDD34 **Critical:** ${report.criticalCount}`);
  lines.push(`- \uD83D\uDFE1 **Warnings:** ${report.warningCount}`);
  lines.push(`- \uD83D\uDD35 **Info:** ${report.infoCount}`);
  lines.push("");
  lines.push("---");
  lines.push("");
  if (report.topRecommendations.length > 0) {
    lines.push("## Top Recommendations");
    lines.push("");
    report.topRecommendations.forEach((rec, index) => {
      const recLines = rec.split(`
`);
      const firstLine = recLines[0] || "";
      let emoji = "\u26AA";
      let severity = "";
      if (firstLine.includes("[CRITICAL]")) {
        emoji = "\uD83D\uDD34";
        severity = "CRITICAL";
      } else if (firstLine.includes("[WARNING]")) {
        emoji = "\uD83D\uDFE1";
        severity = "WARNING";
      } else if (firstLine.includes("[INFO]")) {
        emoji = "\uD83D\uDD35";
        severity = "INFO";
      }
      const title = firstLine.replace(/^\[.*?\]\s*/, "");
      lines.push(`### ${index + 1}. ${emoji} ${title}`);
      for (let i = 1;i < recLines.length; i++) {
        const line = recLines[i].trim();
        if (line.startsWith("\u2192")) {
          const location = line.replace(/^\u2192\s*/, "");
          lines.push(`**File:** \`${location}\``);
        } else if (line) {
          lines.push(`**Suggestion:** ${line}`);
        }
      }
      lines.push("");
    });
    lines.push("---");
    lines.push("");
  }
  lines.push("## Detailed Findings");
  lines.push("");
  report.agentResults.forEach((result) => {
    lines.push(`### ${result.agent}`);
    lines.push("");
    if (result.findings.length === 0) {
      lines.push("\u2713 No issues found");
      lines.push("");
      return;
    }
    result.findings.forEach((finding) => {
      const emoji = getSeverityEmoji(finding.severity);
      const severityLabel = finding.severity.toUpperCase();
      const location = finding.line ? `${finding.file}:${finding.line}` : finding.file;
      lines.push(`#### ${emoji} ${severityLabel}: ${finding.title}`);
      lines.push("");
      lines.push(`- **File:** \`${location}\``);
      if (finding.description) {
        lines.push(`- **Description:** ${finding.description}`);
      }
      if (finding.suggestion) {
        lines.push(`- **Suggestion:** ${finding.suggestion}`);
      }
      lines.push("");
    });
  });
  lines.push("---");
  lines.push("");
  lines.push("*Generated by [AI Code Auditor](https://github.com/yourusername/ai-code-auditor)*");
  lines.push("");
  return lines.join(`
`);
}

// src/auth.ts
import { readFileSync as readFileSync3, writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import { homedir } from "os";
import { join as join2 } from "path";
var CONFIG_DIR = join2(homedir(), ".code-audit");
var CONFIG_FILE = join2(CONFIG_DIR, "config.json");
function getApiKey() {
  const envKey = process.env.CODE_AUDITOR_API_KEY;
  const envUrl = process.env.CODE_AUDITOR_API_URL || "https://code-auditor.com";
  if (envKey) {
    return { apiKey: envKey, apiUrl: envUrl };
  }
  try {
    if (existsSync(CONFIG_FILE)) {
      const configContent = readFileSync3(CONFIG_FILE, "utf-8");
      const config = JSON.parse(configContent);
      if (config.apiKey) {
        return {
          apiKey: config.apiKey,
          apiUrl: config.apiUrl || "https://code-auditor.com"
        };
      }
    }
  } catch (error) {
    console.warn(`Warning: Failed to read auth config: ${error instanceof Error ? error.message : String(error)}`);
  }
  return null;
}
async function promptForApiKey() {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });
  return new Promise((resolve3) => {
    rl.question("Enter your API key (from dashboard): ", (answer) => {
      rl.close();
      resolve3(answer.trim());
    });
  });
}
function validateApiKeyFormat(key) {
  return key.startsWith("ca_") && key.length >= 67;
}
async function validateApiKey(apiKey, apiUrl) {
  try {
    const response = await fetch(`${apiUrl}/api/cli/audit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        overallScore: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        durationMs: 0,
        findings: []
      })
    });
    return response.status !== 401;
  } catch (error) {
    console.warn(`Warning: Could not validate API key: ${error instanceof Error ? error.message : String(error)}`);
    return true;
  }
}
async function login() {
  console.log(`AI Code Audit - Login
`);
  console.log("Get your API key from the dashboard:");
  console.log(`  https://code-auditor.com/settings/api-keys
`);
  const apiKey = await promptForApiKey();
  if (!apiKey) {
    console.error("Error: No API key provided");
    process.exit(1);
  }
  if (!validateApiKeyFormat(apiKey)) {
    console.error("Error: Invalid API key format. Keys should start with 'ca_' and be 64+ characters.");
    process.exit(1);
  }
  console.log(`
Validating API key...`);
  const apiUrl = process.env.CODE_AUDITOR_API_URL || "https://code-auditor.com";
  const isValid = await validateApiKey(apiKey, apiUrl);
  if (!isValid) {
    console.error("Error: API key is invalid or expired. Please check your key and try again.");
    process.exit(1);
  }
  try {
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 448 });
    }
    const config = {
      apiKey,
      apiUrl
    };
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 384 });
    console.log(`
\u2713 Successfully logged in!`);
    console.log(`  Config saved to: ${CONFIG_FILE}`);
    console.log(`
You can now run code-audit without setting CODE_AUDITOR_API_KEY.
`);
  } catch (error) {
    console.error(`Error saving config: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
function logout() {
  try {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
      console.log("\u2713 Logged out successfully");
      console.log(`  Removed config file: ${CONFIG_FILE}
`);
    } else {
      console.log(`Already logged out (no config file found)
`);
    }
  } catch (error) {
    console.error(`Error removing config: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// src/dashboard-sync.ts
function getGitInfo() {
  try {
    const { execSync } = __require("child_process");
    const repo = execSync("git config --get remote.origin.url", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    const commit = execSync("git rev-parse HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "ignore"]
    }).trim();
    return { repo, commit, branch };
  } catch (error) {
    return {};
  }
}
async function syncToDashboard(report, durationMs) {
  const authConfig = getApiKey();
  if (!authConfig) {
    return null;
  }
  const { apiKey, apiUrl } = authConfig;
  try {
    const gitInfo = getGitInfo();
    const findings = report.agentResults.flatMap((result) => result.findings.map((finding) => ({
      agent: result.agent,
      severity: finding.severity.toUpperCase(),
      title: finding.title,
      description: finding.description,
      file: finding.file,
      line: finding.line,
      suggestion: finding.suggestion
    })));
    const payload = {
      repo: gitInfo.repo,
      commit: gitInfo.commit,
      branch: gitInfo.branch,
      overallScore: report.overallScore * 10,
      criticalCount: report.criticalCount,
      warningCount: report.warningCount,
      infoCount: report.infoCount,
      durationMs,
      findings
    };
    const response = await fetch(`${apiUrl}/api/cli/audit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const error = await response.text();
      if (response.status === 401) {
        console.error(`
\u2717 Dashboard sync failed: Invalid API key`);
        console.error("  Your CODE_AUDITOR_API_KEY is invalid or expired.");
        console.error(`  Run 'code-audit login' to reconfigure.
`);
      } else if (response.status === 429) {
        console.error(`
\u2717 Dashboard sync failed: Rate limit or monthly quota exceeded`);
        console.error("  View your plan at: https://code-auditor.com/team");
        console.error(`  Upgrade at: https://code-auditor.com/pricing
`);
      } else {
        console.error(`
\u2717 Dashboard sync failed: ${response.status} ${error}
`);
      }
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error("Error syncing to dashboard:", error instanceof Error ? error.message : String(error));
    return null;
  }
}

// src/cli.ts
function getVersion() {
  try {
    if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
      const pkgPath = resolve3(dirname(fileURLToPath(import.meta.url)), "../package.json");
      const pkg = JSON.parse(readFileSync4(pkgPath, "utf-8"));
      return pkg.version;
    }
    return "0.1.0";
  } catch {
    return "0.1.0";
  }
}
var HELP_TEXT = `
AI Code Audit - Multi-agent code quality analysis tool

USAGE:
  code-audit <path> [options]
  code-audit login
  code-audit logout
  bun run src/cli.ts <path> [options]

COMMANDS:
  login               Save API key for dashboard syncing
  logout              Remove saved API key

ARGUMENTS:
  <path>              Path to file or directory to audit

OPTIONS:
  --output <path>     Write report to file (default: stdout)
  --model <name>      Claude model to use (default: claude-sonnet-4-5-20250929)
  --max-tokens <n>    Maximum tokens per chunk (default: 100000)
  --no-parallel       Disable parallel processing
  --version, -v       Show version number
  --help, -h          Show this help message

ENVIRONMENT:
  ANTHROPIC_API_KEY       Required. Your Anthropic API key
  CODE_AUDITOR_API_KEY    Optional. Dashboard API key (or use 'login' command)
  CODE_AUDITOR_API_URL    Optional. Dashboard URL (default: https://code-auditor.com)

CONFIGURATION:
  Create a .code-audit.json file in your project directory:
  {
    "model": "claude-sonnet-4-5-20250929",
    "maxTokensPerChunk": 100000,
    "parallel": true
  }

EXAMPLES:
  # Login to dashboard
  code-audit login

  # Audit a single file
  code-audit src/main.ts

  # Audit entire directory
  code-audit src/

  # Save report to file
  code-audit src/ --output report.md

  # Use different model
  code-audit src/ --model claude-opus-4-6
`;
function parseCliArgs() {
  try {
    const { values, positionals } = parseArgs({
      options: {
        output: { type: "string" },
        model: { type: "string" },
        "max-tokens": { type: "string" },
        "no-parallel": { type: "boolean" },
        version: { type: "boolean", short: "v" },
        help: { type: "boolean", short: "h" }
      },
      allowPositionals: true
    });
    return {
      path: positionals[0],
      output: values.output,
      model: values.model,
      maxTokens: values["max-tokens"] ? parseInt(values["max-tokens"], 10) : undefined,
      parallel: values["no-parallel"] ? false : undefined,
      version: values.version,
      help: values.help
    };
  } catch (error) {
    console.error("Error parsing arguments:", error instanceof Error ? error.message : String(error));
    console.log(HELP_TEXT);
    process.exit(1);
  }
}
async function main() {
  const firstArg = process.argv[2];
  if (firstArg === "login") {
    await login();
    return;
  }
  if (firstArg === "logout") {
    logout();
    return;
  }
  const args = parseCliArgs();
  if (args.version) {
    console.log(`AI Code Audit v${getVersion()}`);
    process.exit(0);
  }
  if (args.help) {
    console.log(HELP_TEXT);
    process.exit(0);
  }
  if (!args.path) {
    console.error(`Error: Path argument is required
`);
    console.log(HELP_TEXT);
    process.exit(1);
  }
  try {
    console.log("Loading configuration...");
    const config = loadConfig({
      outputPath: args.output,
      model: args.model,
      maxTokensPerChunk: args.maxTokens,
      parallel: args.parallel
    });
    validateConfig(config);
    console.log(`  Model: ${config.model}`);
    console.log(`  Max tokens per chunk: ${config.maxTokensPerChunk.toLocaleString()}`);
    console.log(`  Parallel processing: ${config.parallel ? "enabled" : "disabled"}`);
    if (config.outputPath) {
      console.log(`  Output: ${config.outputPath}`);
    }
    console.log();
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error(`
\u2717 Error: ANTHROPIC_API_KEY not configured
`);
      console.error(`To use AI Code Auditor, you need an Anthropic API key.
`);
      console.error("Get your API key:");
      console.error("  1. Sign up at https://console.anthropic.com/");
      console.error("  2. Go to API Keys section");
      console.error(`  3. Create a new API key
`);
      console.error("Then set it as an environment variable:");
      console.error(`  export ANTHROPIC_API_KEY='your-api-key-here'
`);
      console.error(`Or add it to your shell profile (~/.bashrc, ~/.zshrc, etc.)
`);
      process.exit(1);
    }
    console.log(`Discovering files in: ${args.path}`);
    const files = await discoverFiles(args.path);
    console.log(`  Found ${files.length} file${files.length === 1 ? "" : "s"}`);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`  Total size: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log();
    console.log("Creating chunks...");
    const chunks = createChunks(files, config.maxTokensPerChunk);
    console.log(formatChunkSummary(chunks));
    console.log();
    const startTime = Date.now();
    const agentResults = await runAudit(files, {
      model: config.model,
      maxTokens: 4096
    });
    const durationMs = Date.now() - startTime;
    const report = synthesizeReport(args.path, agentResults);
    printReport(report);
    if (config.outputPath) {
      const markdown = generateMarkdown(report);
      writeFileSync2(config.outputPath, markdown, "utf-8");
      console.log(`
\u2713 Report saved to: ${config.outputPath}
`);
    }
    const dashboardResult = await syncToDashboard(report, durationMs);
    if (dashboardResult) {
      console.log(`
\uD83D\uDCCA View in dashboard: ${dashboardResult.dashboardUrl}
`);
    }
  } catch (error) {
    console.error(`
\u2717 Error:`, error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
main();
