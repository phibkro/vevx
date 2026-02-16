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
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: true,
      configurable: true,
      set: (newValue) => all[name] = () => newValue
    });
};
var __require = import.meta.require;

// src/cli.ts
import { parseArgs } from "util";
import { writeFileSync as writeFileSync2, readFileSync as readFileSync4 } from "fs";
import { resolve as resolve4, dirname } from "path";
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
  const { onProgress } = options;
  onProgress?.({ type: "started", agentCount: agents.length });
  if (!onProgress) {
    console.log(`
Running ${agents.length} agents in parallel...`);
  }
  const startTime = Date.now();
  const results = await Promise.allSettled(agents.map(async (agent) => {
    onProgress?.({ type: "agent-started", agent: agent.name });
    const result = await runAgent(agent, files, options);
    onProgress?.({
      type: "agent-completed",
      agent: agent.name,
      score: result.score,
      duration: result.durationMs / 1000
    });
    return result;
  }));
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
  onProgress?.({ type: "completed", totalDuration: totalDuration / 1000 });
  if (!onProgress) {
    console.log(`All agents completed in ${(totalDuration / 1000).toFixed(2)}s`);
    agentResults.forEach((result) => {
      const status = result.score > 0 ? "\u2713" : "\u2717";
      const duration = (result.durationMs / 1000).toFixed(2);
      console.log(`  ${status} ${result.agent.padEnd(15)} - ${duration}s - Score: ${result.score.toFixed(1)}/10 - ${result.findings.length} findings`);
    });
  }
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

// ../../node_modules/.bun/ora@9.3.0/node_modules/ora/index.js
import process8 from "process";
import { stripVTControlCharacters } from "util";

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/vendor/ansi-styles/index.js
var ANSI_BACKGROUND_OFFSET = 10;
var wrapAnsi16 = (offset = 0) => (code) => `\x1B[${code + offset}m`;
var wrapAnsi256 = (offset = 0) => (code) => `\x1B[${38 + offset};5;${code}m`;
var wrapAnsi16m = (offset = 0) => (red, green, blue) => `\x1B[${38 + offset};2;${red};${green};${blue}m`;
var styles = {
  modifier: {
    reset: [0, 0],
    bold: [1, 22],
    dim: [2, 22],
    italic: [3, 23],
    underline: [4, 24],
    overline: [53, 55],
    inverse: [7, 27],
    hidden: [8, 28],
    strikethrough: [9, 29]
  },
  color: {
    black: [30, 39],
    red: [31, 39],
    green: [32, 39],
    yellow: [33, 39],
    blue: [34, 39],
    magenta: [35, 39],
    cyan: [36, 39],
    white: [37, 39],
    blackBright: [90, 39],
    gray: [90, 39],
    grey: [90, 39],
    redBright: [91, 39],
    greenBright: [92, 39],
    yellowBright: [93, 39],
    blueBright: [94, 39],
    magentaBright: [95, 39],
    cyanBright: [96, 39],
    whiteBright: [97, 39]
  },
  bgColor: {
    bgBlack: [40, 49],
    bgRed: [41, 49],
    bgGreen: [42, 49],
    bgYellow: [43, 49],
    bgBlue: [44, 49],
    bgMagenta: [45, 49],
    bgCyan: [46, 49],
    bgWhite: [47, 49],
    bgBlackBright: [100, 49],
    bgGray: [100, 49],
    bgGrey: [100, 49],
    bgRedBright: [101, 49],
    bgGreenBright: [102, 49],
    bgYellowBright: [103, 49],
    bgBlueBright: [104, 49],
    bgMagentaBright: [105, 49],
    bgCyanBright: [106, 49],
    bgWhiteBright: [107, 49]
  }
};
var modifierNames = Object.keys(styles.modifier);
var foregroundColorNames = Object.keys(styles.color);
var backgroundColorNames = Object.keys(styles.bgColor);
var colorNames = [...foregroundColorNames, ...backgroundColorNames];
function assembleStyles() {
  const codes = new Map;
  for (const [groupName, group] of Object.entries(styles)) {
    for (const [styleName, style] of Object.entries(group)) {
      styles[styleName] = {
        open: `\x1B[${style[0]}m`,
        close: `\x1B[${style[1]}m`
      };
      group[styleName] = styles[styleName];
      codes.set(style[0], style[1]);
    }
    Object.defineProperty(styles, groupName, {
      value: group,
      enumerable: false
    });
  }
  Object.defineProperty(styles, "codes", {
    value: codes,
    enumerable: false
  });
  styles.color.close = "\x1B[39m";
  styles.bgColor.close = "\x1B[49m";
  styles.color.ansi = wrapAnsi16();
  styles.color.ansi256 = wrapAnsi256();
  styles.color.ansi16m = wrapAnsi16m();
  styles.bgColor.ansi = wrapAnsi16(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi256 = wrapAnsi256(ANSI_BACKGROUND_OFFSET);
  styles.bgColor.ansi16m = wrapAnsi16m(ANSI_BACKGROUND_OFFSET);
  Object.defineProperties(styles, {
    rgbToAnsi256: {
      value(red, green, blue) {
        if (red === green && green === blue) {
          if (red < 8) {
            return 16;
          }
          if (red > 248) {
            return 231;
          }
          return Math.round((red - 8) / 247 * 24) + 232;
        }
        return 16 + 36 * Math.round(red / 255 * 5) + 6 * Math.round(green / 255 * 5) + Math.round(blue / 255 * 5);
      },
      enumerable: false
    },
    hexToRgb: {
      value(hex) {
        const matches = /[a-f\d]{6}|[a-f\d]{3}/i.exec(hex.toString(16));
        if (!matches) {
          return [0, 0, 0];
        }
        let [colorString] = matches;
        if (colorString.length === 3) {
          colorString = [...colorString].map((character) => character + character).join("");
        }
        const integer = Number.parseInt(colorString, 16);
        return [
          integer >> 16 & 255,
          integer >> 8 & 255,
          integer & 255
        ];
      },
      enumerable: false
    },
    hexToAnsi256: {
      value: (hex) => styles.rgbToAnsi256(...styles.hexToRgb(hex)),
      enumerable: false
    },
    ansi256ToAnsi: {
      value(code) {
        if (code < 8) {
          return 30 + code;
        }
        if (code < 16) {
          return 90 + (code - 8);
        }
        let red;
        let green;
        let blue;
        if (code >= 232) {
          red = ((code - 232) * 10 + 8) / 255;
          green = red;
          blue = red;
        } else {
          code -= 16;
          const remainder = code % 36;
          red = Math.floor(code / 36) / 5;
          green = Math.floor(remainder / 6) / 5;
          blue = remainder % 6 / 5;
        }
        const value = Math.max(red, green, blue) * 2;
        if (value === 0) {
          return 30;
        }
        let result = 30 + (Math.round(blue) << 2 | Math.round(green) << 1 | Math.round(red));
        if (value === 2) {
          result += 60;
        }
        return result;
      },
      enumerable: false
    },
    rgbToAnsi: {
      value: (red, green, blue) => styles.ansi256ToAnsi(styles.rgbToAnsi256(red, green, blue)),
      enumerable: false
    },
    hexToAnsi: {
      value: (hex) => styles.ansi256ToAnsi(styles.hexToAnsi256(hex)),
      enumerable: false
    }
  });
  return styles;
}
var ansiStyles = assembleStyles();
var ansi_styles_default = ansiStyles;

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/vendor/supports-color/index.js
import process2 from "process";
import os from "os";
import tty from "tty";
function hasFlag(flag, argv = globalThis.Deno ? globalThis.Deno.args : process2.argv) {
  const prefix = flag.startsWith("-") ? "" : flag.length === 1 ? "-" : "--";
  const position = argv.indexOf(prefix + flag);
  const terminatorPosition = argv.indexOf("--");
  return position !== -1 && (terminatorPosition === -1 || position < terminatorPosition);
}
var { env } = process2;
var flagForceColor;
if (hasFlag("no-color") || hasFlag("no-colors") || hasFlag("color=false") || hasFlag("color=never")) {
  flagForceColor = 0;
} else if (hasFlag("color") || hasFlag("colors") || hasFlag("color=true") || hasFlag("color=always")) {
  flagForceColor = 1;
}
function envForceColor() {
  if ("FORCE_COLOR" in env) {
    if (env.FORCE_COLOR === "true") {
      return 1;
    }
    if (env.FORCE_COLOR === "false") {
      return 0;
    }
    return env.FORCE_COLOR.length === 0 ? 1 : Math.min(Number.parseInt(env.FORCE_COLOR, 10), 3);
  }
}
function translateLevel(level) {
  if (level === 0) {
    return false;
  }
  return {
    level,
    hasBasic: true,
    has256: level >= 2,
    has16m: level >= 3
  };
}
function _supportsColor(haveStream, { streamIsTTY, sniffFlags = true } = {}) {
  const noFlagForceColor = envForceColor();
  if (noFlagForceColor !== undefined) {
    flagForceColor = noFlagForceColor;
  }
  const forceColor = sniffFlags ? flagForceColor : noFlagForceColor;
  if (forceColor === 0) {
    return 0;
  }
  if (sniffFlags) {
    if (hasFlag("color=16m") || hasFlag("color=full") || hasFlag("color=truecolor")) {
      return 3;
    }
    if (hasFlag("color=256")) {
      return 2;
    }
  }
  if ("TF_BUILD" in env && "AGENT_NAME" in env) {
    return 1;
  }
  if (haveStream && !streamIsTTY && forceColor === undefined) {
    return 0;
  }
  const min = forceColor || 0;
  if (env.TERM === "dumb") {
    return min;
  }
  if (process2.platform === "win32") {
    const osRelease = os.release().split(".");
    if (Number(osRelease[0]) >= 10 && Number(osRelease[2]) >= 10586) {
      return Number(osRelease[2]) >= 14931 ? 3 : 2;
    }
    return 1;
  }
  if ("CI" in env) {
    if (["GITHUB_ACTIONS", "GITEA_ACTIONS", "CIRCLECI"].some((key) => (key in env))) {
      return 3;
    }
    if (["TRAVIS", "APPVEYOR", "GITLAB_CI", "BUILDKITE", "DRONE"].some((sign) => (sign in env)) || env.CI_NAME === "codeship") {
      return 1;
    }
    return min;
  }
  if ("TEAMCITY_VERSION" in env) {
    return /^(9\.(0*[1-9]\d*)\.|\d{2,}\.)/.test(env.TEAMCITY_VERSION) ? 1 : 0;
  }
  if (env.COLORTERM === "truecolor") {
    return 3;
  }
  if (env.TERM === "xterm-kitty") {
    return 3;
  }
  if (env.TERM === "xterm-ghostty") {
    return 3;
  }
  if (env.TERM === "wezterm") {
    return 3;
  }
  if ("TERM_PROGRAM" in env) {
    const version = Number.parseInt((env.TERM_PROGRAM_VERSION || "").split(".")[0], 10);
    switch (env.TERM_PROGRAM) {
      case "iTerm.app": {
        return version >= 3 ? 3 : 2;
      }
      case "Apple_Terminal": {
        return 2;
      }
    }
  }
  if (/-256(color)?$/i.test(env.TERM)) {
    return 2;
  }
  if (/^screen|^xterm|^vt100|^vt220|^rxvt|color|ansi|cygwin|linux/i.test(env.TERM)) {
    return 1;
  }
  if ("COLORTERM" in env) {
    return 1;
  }
  return min;
}
function createSupportsColor(stream, options = {}) {
  const level = _supportsColor(stream, {
    streamIsTTY: stream && stream.isTTY,
    ...options
  });
  return translateLevel(level);
}
var supportsColor = {
  stdout: createSupportsColor({ isTTY: tty.isatty(1) }),
  stderr: createSupportsColor({ isTTY: tty.isatty(2) })
};
var supports_color_default = supportsColor;

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/utilities.js
function stringReplaceAll(string, substring, replacer) {
  let index = string.indexOf(substring);
  if (index === -1) {
    return string;
  }
  const substringLength = substring.length;
  let endIndex = 0;
  let returnValue = "";
  do {
    returnValue += string.slice(endIndex, index) + substring + replacer;
    endIndex = index + substringLength;
    index = string.indexOf(substring, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}
function stringEncaseCRLFWithFirstIndex(string, prefix, postfix, index) {
  let endIndex = 0;
  let returnValue = "";
  do {
    const gotCR = string[index - 1] === "\r";
    returnValue += string.slice(endIndex, gotCR ? index - 1 : index) + prefix + (gotCR ? `\r
` : `
`) + postfix;
    endIndex = index + 1;
    index = string.indexOf(`
`, endIndex);
  } while (index !== -1);
  returnValue += string.slice(endIndex);
  return returnValue;
}

// ../../node_modules/.bun/chalk@5.6.2/node_modules/chalk/source/index.js
var { stdout: stdoutColor, stderr: stderrColor } = supports_color_default;
var GENERATOR = Symbol("GENERATOR");
var STYLER = Symbol("STYLER");
var IS_EMPTY = Symbol("IS_EMPTY");
var levelMapping = [
  "ansi",
  "ansi",
  "ansi256",
  "ansi16m"
];
var styles2 = Object.create(null);
var applyOptions = (object, options = {}) => {
  if (options.level && !(Number.isInteger(options.level) && options.level >= 0 && options.level <= 3)) {
    throw new Error("The `level` option should be an integer from 0 to 3");
  }
  const colorLevel = stdoutColor ? stdoutColor.level : 0;
  object.level = options.level === undefined ? colorLevel : options.level;
};
var chalkFactory = (options) => {
  const chalk = (...strings) => strings.join(" ");
  applyOptions(chalk, options);
  Object.setPrototypeOf(chalk, createChalk.prototype);
  return chalk;
};
function createChalk(options) {
  return chalkFactory(options);
}
Object.setPrototypeOf(createChalk.prototype, Function.prototype);
for (const [styleName, style] of Object.entries(ansi_styles_default)) {
  styles2[styleName] = {
    get() {
      const builder = createBuilder(this, createStyler(style.open, style.close, this[STYLER]), this[IS_EMPTY]);
      Object.defineProperty(this, styleName, { value: builder });
      return builder;
    }
  };
}
styles2.visible = {
  get() {
    const builder = createBuilder(this, this[STYLER], true);
    Object.defineProperty(this, "visible", { value: builder });
    return builder;
  }
};
var getModelAnsi = (model, level, type, ...arguments_) => {
  if (model === "rgb") {
    if (level === "ansi16m") {
      return ansi_styles_default[type].ansi16m(...arguments_);
    }
    if (level === "ansi256") {
      return ansi_styles_default[type].ansi256(ansi_styles_default.rgbToAnsi256(...arguments_));
    }
    return ansi_styles_default[type].ansi(ansi_styles_default.rgbToAnsi(...arguments_));
  }
  if (model === "hex") {
    return getModelAnsi("rgb", level, type, ...ansi_styles_default.hexToRgb(...arguments_));
  }
  return ansi_styles_default[type][model](...arguments_);
};
var usedModels = ["rgb", "hex", "ansi256"];
for (const model of usedModels) {
  styles2[model] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "color", ...arguments_), ansi_styles_default.color.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
  const bgModel = "bg" + model[0].toUpperCase() + model.slice(1);
  styles2[bgModel] = {
    get() {
      const { level } = this;
      return function(...arguments_) {
        const styler = createStyler(getModelAnsi(model, levelMapping[level], "bgColor", ...arguments_), ansi_styles_default.bgColor.close, this[STYLER]);
        return createBuilder(this, styler, this[IS_EMPTY]);
      };
    }
  };
}
var proto = Object.defineProperties(() => {}, {
  ...styles2,
  level: {
    enumerable: true,
    get() {
      return this[GENERATOR].level;
    },
    set(level) {
      this[GENERATOR].level = level;
    }
  }
});
var createStyler = (open, close, parent) => {
  let openAll;
  let closeAll;
  if (parent === undefined) {
    openAll = open;
    closeAll = close;
  } else {
    openAll = parent.openAll + open;
    closeAll = close + parent.closeAll;
  }
  return {
    open,
    close,
    openAll,
    closeAll,
    parent
  };
};
var createBuilder = (self, _styler, _isEmpty) => {
  const builder = (...arguments_) => applyStyle(builder, arguments_.length === 1 ? "" + arguments_[0] : arguments_.join(" "));
  Object.setPrototypeOf(builder, proto);
  builder[GENERATOR] = self;
  builder[STYLER] = _styler;
  builder[IS_EMPTY] = _isEmpty;
  return builder;
};
var applyStyle = (self, string) => {
  if (self.level <= 0 || !string) {
    return self[IS_EMPTY] ? "" : string;
  }
  let styler = self[STYLER];
  if (styler === undefined) {
    return string;
  }
  const { openAll, closeAll } = styler;
  if (string.includes("\x1B")) {
    while (styler !== undefined) {
      string = stringReplaceAll(string, styler.close, styler.open);
      styler = styler.parent;
    }
  }
  const lfIndex = string.indexOf(`
`);
  if (lfIndex !== -1) {
    string = stringEncaseCRLFWithFirstIndex(string, closeAll, openAll, lfIndex);
  }
  return openAll + string + closeAll;
};
Object.defineProperties(createChalk.prototype, styles2);
var chalk = createChalk();
var chalkStderr = createChalk({ level: stderrColor ? stderrColor.level : 0 });
var source_default = chalk;

// ../../node_modules/.bun/cli-cursor@5.0.0/node_modules/cli-cursor/index.js
import process5 from "process";

// ../../node_modules/.bun/restore-cursor@5.1.0/node_modules/restore-cursor/index.js
import process4 from "process";

// ../../node_modules/.bun/mimic-function@5.0.1/node_modules/mimic-function/index.js
var copyProperty = (to, from, property, ignoreNonConfigurable) => {
  if (property === "length" || property === "prototype") {
    return;
  }
  if (property === "arguments" || property === "caller") {
    return;
  }
  const toDescriptor = Object.getOwnPropertyDescriptor(to, property);
  const fromDescriptor = Object.getOwnPropertyDescriptor(from, property);
  if (!canCopyProperty(toDescriptor, fromDescriptor) && ignoreNonConfigurable) {
    return;
  }
  Object.defineProperty(to, property, fromDescriptor);
};
var canCopyProperty = function(toDescriptor, fromDescriptor) {
  return toDescriptor === undefined || toDescriptor.configurable || toDescriptor.writable === fromDescriptor.writable && toDescriptor.enumerable === fromDescriptor.enumerable && toDescriptor.configurable === fromDescriptor.configurable && (toDescriptor.writable || toDescriptor.value === fromDescriptor.value);
};
var changePrototype = (to, from) => {
  const fromPrototype = Object.getPrototypeOf(from);
  if (fromPrototype === Object.getPrototypeOf(to)) {
    return;
  }
  Object.setPrototypeOf(to, fromPrototype);
};
var wrappedToString = (withName, fromBody) => `/* Wrapped ${withName}*/
${fromBody}`;
var toStringDescriptor = Object.getOwnPropertyDescriptor(Function.prototype, "toString");
var toStringName = Object.getOwnPropertyDescriptor(Function.prototype.toString, "name");
var changeToString = (to, from, name) => {
  const withName = name === "" ? "" : `with ${name.trim()}() `;
  const newToString = wrappedToString.bind(null, withName, from.toString());
  Object.defineProperty(newToString, "name", toStringName);
  const { writable, enumerable, configurable } = toStringDescriptor;
  Object.defineProperty(to, "toString", { value: newToString, writable, enumerable, configurable });
};
function mimicFunction(to, from, { ignoreNonConfigurable = false } = {}) {
  const { name } = to;
  for (const property of Reflect.ownKeys(from)) {
    copyProperty(to, from, property, ignoreNonConfigurable);
  }
  changePrototype(to, from);
  changeToString(to, from, name);
  return to;
}

// ../../node_modules/.bun/onetime@7.0.0/node_modules/onetime/index.js
var calledFunctions = new WeakMap;
var onetime = (function_, options = {}) => {
  if (typeof function_ !== "function") {
    throw new TypeError("Expected a function");
  }
  let returnValue;
  let callCount = 0;
  const functionName = function_.displayName || function_.name || "<anonymous>";
  const onetime2 = function(...arguments_) {
    calledFunctions.set(onetime2, ++callCount);
    if (callCount === 1) {
      returnValue = function_.apply(this, arguments_);
      function_ = undefined;
    } else if (options.throw === true) {
      throw new Error(`Function \`${functionName}\` can only be called once`);
    }
    return returnValue;
  };
  mimicFunction(onetime2, function_);
  calledFunctions.set(onetime2, callCount);
  return onetime2;
};
onetime.callCount = (function_) => {
  if (!calledFunctions.has(function_)) {
    throw new Error(`The given function \`${function_.name}\` is not wrapped by the \`onetime\` package`);
  }
  return calledFunctions.get(function_);
};
var onetime_default = onetime;

// ../../node_modules/.bun/signal-exit@4.1.0/node_modules/signal-exit/dist/mjs/signals.js
var signals = [];
signals.push("SIGHUP", "SIGINT", "SIGTERM");
if (process.platform !== "win32") {
  signals.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
}
if (process.platform === "linux") {
  signals.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");
}

// ../../node_modules/.bun/signal-exit@4.1.0/node_modules/signal-exit/dist/mjs/index.js
var processOk = (process3) => !!process3 && typeof process3 === "object" && typeof process3.removeListener === "function" && typeof process3.emit === "function" && typeof process3.reallyExit === "function" && typeof process3.listeners === "function" && typeof process3.kill === "function" && typeof process3.pid === "number" && typeof process3.on === "function";
var kExitEmitter = Symbol.for("signal-exit emitter");
var global = globalThis;
var ObjectDefineProperty = Object.defineProperty.bind(Object);

class Emitter {
  emitted = {
    afterExit: false,
    exit: false
  };
  listeners = {
    afterExit: [],
    exit: []
  };
  count = 0;
  id = Math.random();
  constructor() {
    if (global[kExitEmitter]) {
      return global[kExitEmitter];
    }
    ObjectDefineProperty(global, kExitEmitter, {
      value: this,
      writable: false,
      enumerable: false,
      configurable: false
    });
  }
  on(ev, fn) {
    this.listeners[ev].push(fn);
  }
  removeListener(ev, fn) {
    const list = this.listeners[ev];
    const i = list.indexOf(fn);
    if (i === -1) {
      return;
    }
    if (i === 0 && list.length === 1) {
      list.length = 0;
    } else {
      list.splice(i, 1);
    }
  }
  emit(ev, code, signal) {
    if (this.emitted[ev]) {
      return false;
    }
    this.emitted[ev] = true;
    let ret = false;
    for (const fn of this.listeners[ev]) {
      ret = fn(code, signal) === true || ret;
    }
    if (ev === "exit") {
      ret = this.emit("afterExit", code, signal) || ret;
    }
    return ret;
  }
}

class SignalExitBase {
}
var signalExitWrap = (handler) => {
  return {
    onExit(cb, opts) {
      return handler.onExit(cb, opts);
    },
    load() {
      return handler.load();
    },
    unload() {
      return handler.unload();
    }
  };
};

class SignalExitFallback extends SignalExitBase {
  onExit() {
    return () => {};
  }
  load() {}
  unload() {}
}

class SignalExit extends SignalExitBase {
  #hupSig = process3.platform === "win32" ? "SIGINT" : "SIGHUP";
  #emitter = new Emitter;
  #process;
  #originalProcessEmit;
  #originalProcessReallyExit;
  #sigListeners = {};
  #loaded = false;
  constructor(process3) {
    super();
    this.#process = process3;
    this.#sigListeners = {};
    for (const sig of signals) {
      this.#sigListeners[sig] = () => {
        const listeners = this.#process.listeners(sig);
        let { count } = this.#emitter;
        const p = process3;
        if (typeof p.__signal_exit_emitter__ === "object" && typeof p.__signal_exit_emitter__.count === "number") {
          count += p.__signal_exit_emitter__.count;
        }
        if (listeners.length === count) {
          this.unload();
          const ret = this.#emitter.emit("exit", null, sig);
          const s = sig === "SIGHUP" ? this.#hupSig : sig;
          if (!ret)
            process3.kill(process3.pid, s);
        }
      };
    }
    this.#originalProcessReallyExit = process3.reallyExit;
    this.#originalProcessEmit = process3.emit;
  }
  onExit(cb, opts) {
    if (!processOk(this.#process)) {
      return () => {};
    }
    if (this.#loaded === false) {
      this.load();
    }
    const ev = opts?.alwaysLast ? "afterExit" : "exit";
    this.#emitter.on(ev, cb);
    return () => {
      this.#emitter.removeListener(ev, cb);
      if (this.#emitter.listeners["exit"].length === 0 && this.#emitter.listeners["afterExit"].length === 0) {
        this.unload();
      }
    };
  }
  load() {
    if (this.#loaded) {
      return;
    }
    this.#loaded = true;
    this.#emitter.count += 1;
    for (const sig of signals) {
      try {
        const fn = this.#sigListeners[sig];
        if (fn)
          this.#process.on(sig, fn);
      } catch (_) {}
    }
    this.#process.emit = (ev, ...a) => {
      return this.#processEmit(ev, ...a);
    };
    this.#process.reallyExit = (code) => {
      return this.#processReallyExit(code);
    };
  }
  unload() {
    if (!this.#loaded) {
      return;
    }
    this.#loaded = false;
    signals.forEach((sig) => {
      const listener = this.#sigListeners[sig];
      if (!listener) {
        throw new Error("Listener not defined for signal: " + sig);
      }
      try {
        this.#process.removeListener(sig, listener);
      } catch (_) {}
    });
    this.#process.emit = this.#originalProcessEmit;
    this.#process.reallyExit = this.#originalProcessReallyExit;
    this.#emitter.count -= 1;
  }
  #processReallyExit(code) {
    if (!processOk(this.#process)) {
      return 0;
    }
    this.#process.exitCode = code || 0;
    this.#emitter.emit("exit", this.#process.exitCode, null);
    return this.#originalProcessReallyExit.call(this.#process, this.#process.exitCode);
  }
  #processEmit(ev, ...args) {
    const og = this.#originalProcessEmit;
    if (ev === "exit" && processOk(this.#process)) {
      if (typeof args[0] === "number") {
        this.#process.exitCode = args[0];
      }
      const ret = og.call(this.#process, ev, ...args);
      this.#emitter.emit("exit", this.#process.exitCode, null);
      return ret;
    } else {
      return og.call(this.#process, ev, ...args);
    }
  }
}
var process3 = globalThis.process;
var {
  onExit,
  load,
  unload
} = signalExitWrap(processOk(process3) ? new SignalExit(process3) : new SignalExitFallback);

// ../../node_modules/.bun/restore-cursor@5.1.0/node_modules/restore-cursor/index.js
var terminal = process4.stderr.isTTY ? process4.stderr : process4.stdout.isTTY ? process4.stdout : undefined;
var restoreCursor = terminal ? onetime_default(() => {
  onExit(() => {
    terminal.write("\x1B[?25h");
  }, { alwaysLast: true });
}) : () => {};
var restore_cursor_default = restoreCursor;

// ../../node_modules/.bun/cli-cursor@5.0.0/node_modules/cli-cursor/index.js
var isHidden = false;
var cliCursor = {};
cliCursor.show = (writableStream = process5.stderr) => {
  if (!writableStream.isTTY) {
    return;
  }
  isHidden = false;
  writableStream.write("\x1B[?25h");
};
cliCursor.hide = (writableStream = process5.stderr) => {
  if (!writableStream.isTTY) {
    return;
  }
  restore_cursor_default();
  isHidden = true;
  writableStream.write("\x1B[?25l");
};
cliCursor.toggle = (force, writableStream) => {
  if (force !== undefined) {
    isHidden = force;
  }
  if (isHidden) {
    cliCursor.show(writableStream);
  } else {
    cliCursor.hide(writableStream);
  }
};
var cli_cursor_default = cliCursor;
// ../../node_modules/.bun/cli-spinners@3.4.0/node_modules/cli-spinners/spinners.json
var spinners_default = {
  dots: {
    interval: 80,
    frames: [
      "\u280B",
      "\u2819",
      "\u2839",
      "\u2838",
      "\u283C",
      "\u2834",
      "\u2826",
      "\u2827",
      "\u2807",
      "\u280F"
    ]
  },
  dots2: {
    interval: 80,
    frames: [
      "\u28FE",
      "\u28FD",
      "\u28FB",
      "\u28BF",
      "\u287F",
      "\u28DF",
      "\u28EF",
      "\u28F7"
    ]
  },
  dots3: {
    interval: 80,
    frames: [
      "\u280B",
      "\u2819",
      "\u281A",
      "\u281E",
      "\u2816",
      "\u2826",
      "\u2834",
      "\u2832",
      "\u2833",
      "\u2813"
    ]
  },
  dots4: {
    interval: 80,
    frames: [
      "\u2804",
      "\u2806",
      "\u2807",
      "\u280B",
      "\u2819",
      "\u2838",
      "\u2830",
      "\u2820",
      "\u2830",
      "\u2838",
      "\u2819",
      "\u280B",
      "\u2807",
      "\u2806"
    ]
  },
  dots5: {
    interval: 80,
    frames: [
      "\u280B",
      "\u2819",
      "\u281A",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u2832",
      "\u2834",
      "\u2826",
      "\u2816",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2813",
      "\u280B"
    ]
  },
  dots6: {
    interval: 80,
    frames: [
      "\u2801",
      "\u2809",
      "\u2819",
      "\u281A",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u2832",
      "\u2834",
      "\u2824",
      "\u2804",
      "\u2804",
      "\u2824",
      "\u2834",
      "\u2832",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u281A",
      "\u2819",
      "\u2809",
      "\u2801"
    ]
  },
  dots7: {
    interval: 80,
    frames: [
      "\u2808",
      "\u2809",
      "\u280B",
      "\u2813",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2816",
      "\u2826",
      "\u2824",
      "\u2820",
      "\u2820",
      "\u2824",
      "\u2826",
      "\u2816",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2813",
      "\u280B",
      "\u2809",
      "\u2808"
    ]
  },
  dots8: {
    interval: 80,
    frames: [
      "\u2801",
      "\u2801",
      "\u2809",
      "\u2819",
      "\u281A",
      "\u2812",
      "\u2802",
      "\u2802",
      "\u2812",
      "\u2832",
      "\u2834",
      "\u2824",
      "\u2804",
      "\u2804",
      "\u2824",
      "\u2820",
      "\u2820",
      "\u2824",
      "\u2826",
      "\u2816",
      "\u2812",
      "\u2810",
      "\u2810",
      "\u2812",
      "\u2813",
      "\u280B",
      "\u2809",
      "\u2808",
      "\u2808"
    ]
  },
  dots9: {
    interval: 80,
    frames: [
      "\u28B9",
      "\u28BA",
      "\u28BC",
      "\u28F8",
      "\u28C7",
      "\u2867",
      "\u2857",
      "\u284F"
    ]
  },
  dots10: {
    interval: 80,
    frames: [
      "\u2884",
      "\u2882",
      "\u2881",
      "\u2841",
      "\u2848",
      "\u2850",
      "\u2860"
    ]
  },
  dots11: {
    interval: 100,
    frames: [
      "\u2801",
      "\u2802",
      "\u2804",
      "\u2840",
      "\u2880",
      "\u2820",
      "\u2810",
      "\u2808"
    ]
  },
  dots12: {
    interval: 80,
    frames: [
      "\u2880\u2800",
      "\u2840\u2800",
      "\u2804\u2800",
      "\u2882\u2800",
      "\u2842\u2800",
      "\u2805\u2800",
      "\u2883\u2800",
      "\u2843\u2800",
      "\u280D\u2800",
      "\u288B\u2800",
      "\u284B\u2800",
      "\u280D\u2801",
      "\u288B\u2801",
      "\u284B\u2801",
      "\u280D\u2809",
      "\u280B\u2809",
      "\u280B\u2809",
      "\u2809\u2819",
      "\u2809\u2819",
      "\u2809\u2829",
      "\u2808\u2899",
      "\u2808\u2859",
      "\u2888\u2829",
      "\u2840\u2899",
      "\u2804\u2859",
      "\u2882\u2829",
      "\u2842\u2898",
      "\u2805\u2858",
      "\u2883\u2828",
      "\u2843\u2890",
      "\u280D\u2850",
      "\u288B\u2820",
      "\u284B\u2880",
      "\u280D\u2841",
      "\u288B\u2801",
      "\u284B\u2801",
      "\u280D\u2809",
      "\u280B\u2809",
      "\u280B\u2809",
      "\u2809\u2819",
      "\u2809\u2819",
      "\u2809\u2829",
      "\u2808\u2899",
      "\u2808\u2859",
      "\u2808\u2829",
      "\u2800\u2899",
      "\u2800\u2859",
      "\u2800\u2829",
      "\u2800\u2898",
      "\u2800\u2858",
      "\u2800\u2828",
      "\u2800\u2890",
      "\u2800\u2850",
      "\u2800\u2820",
      "\u2800\u2880",
      "\u2800\u2840"
    ]
  },
  dots13: {
    interval: 80,
    frames: [
      "\u28FC",
      "\u28F9",
      "\u28BB",
      "\u283F",
      "\u285F",
      "\u28CF",
      "\u28E7",
      "\u28F6"
    ]
  },
  dots14: {
    interval: 80,
    frames: [
      "\u2809\u2809",
      "\u2808\u2819",
      "\u2800\u2839",
      "\u2800\u28B8",
      "\u2800\u28F0",
      "\u2880\u28E0",
      "\u28C0\u28C0",
      "\u28C4\u2840",
      "\u28C6\u2800",
      "\u2847\u2800",
      "\u280F\u2800",
      "\u280B\u2801"
    ]
  },
  dots8Bit: {
    interval: 80,
    frames: [
      "\u2800",
      "\u2801",
      "\u2802",
      "\u2803",
      "\u2804",
      "\u2805",
      "\u2806",
      "\u2807",
      "\u2840",
      "\u2841",
      "\u2842",
      "\u2843",
      "\u2844",
      "\u2845",
      "\u2846",
      "\u2847",
      "\u2808",
      "\u2809",
      "\u280A",
      "\u280B",
      "\u280C",
      "\u280D",
      "\u280E",
      "\u280F",
      "\u2848",
      "\u2849",
      "\u284A",
      "\u284B",
      "\u284C",
      "\u284D",
      "\u284E",
      "\u284F",
      "\u2810",
      "\u2811",
      "\u2812",
      "\u2813",
      "\u2814",
      "\u2815",
      "\u2816",
      "\u2817",
      "\u2850",
      "\u2851",
      "\u2852",
      "\u2853",
      "\u2854",
      "\u2855",
      "\u2856",
      "\u2857",
      "\u2818",
      "\u2819",
      "\u281A",
      "\u281B",
      "\u281C",
      "\u281D",
      "\u281E",
      "\u281F",
      "\u2858",
      "\u2859",
      "\u285A",
      "\u285B",
      "\u285C",
      "\u285D",
      "\u285E",
      "\u285F",
      "\u2820",
      "\u2821",
      "\u2822",
      "\u2823",
      "\u2824",
      "\u2825",
      "\u2826",
      "\u2827",
      "\u2860",
      "\u2861",
      "\u2862",
      "\u2863",
      "\u2864",
      "\u2865",
      "\u2866",
      "\u2867",
      "\u2828",
      "\u2829",
      "\u282A",
      "\u282B",
      "\u282C",
      "\u282D",
      "\u282E",
      "\u282F",
      "\u2868",
      "\u2869",
      "\u286A",
      "\u286B",
      "\u286C",
      "\u286D",
      "\u286E",
      "\u286F",
      "\u2830",
      "\u2831",
      "\u2832",
      "\u2833",
      "\u2834",
      "\u2835",
      "\u2836",
      "\u2837",
      "\u2870",
      "\u2871",
      "\u2872",
      "\u2873",
      "\u2874",
      "\u2875",
      "\u2876",
      "\u2877",
      "\u2838",
      "\u2839",
      "\u283A",
      "\u283B",
      "\u283C",
      "\u283D",
      "\u283E",
      "\u283F",
      "\u2878",
      "\u2879",
      "\u287A",
      "\u287B",
      "\u287C",
      "\u287D",
      "\u287E",
      "\u287F",
      "\u2880",
      "\u2881",
      "\u2882",
      "\u2883",
      "\u2884",
      "\u2885",
      "\u2886",
      "\u2887",
      "\u28C0",
      "\u28C1",
      "\u28C2",
      "\u28C3",
      "\u28C4",
      "\u28C5",
      "\u28C6",
      "\u28C7",
      "\u2888",
      "\u2889",
      "\u288A",
      "\u288B",
      "\u288C",
      "\u288D",
      "\u288E",
      "\u288F",
      "\u28C8",
      "\u28C9",
      "\u28CA",
      "\u28CB",
      "\u28CC",
      "\u28CD",
      "\u28CE",
      "\u28CF",
      "\u2890",
      "\u2891",
      "\u2892",
      "\u2893",
      "\u2894",
      "\u2895",
      "\u2896",
      "\u2897",
      "\u28D0",
      "\u28D1",
      "\u28D2",
      "\u28D3",
      "\u28D4",
      "\u28D5",
      "\u28D6",
      "\u28D7",
      "\u2898",
      "\u2899",
      "\u289A",
      "\u289B",
      "\u289C",
      "\u289D",
      "\u289E",
      "\u289F",
      "\u28D8",
      "\u28D9",
      "\u28DA",
      "\u28DB",
      "\u28DC",
      "\u28DD",
      "\u28DE",
      "\u28DF",
      "\u28A0",
      "\u28A1",
      "\u28A2",
      "\u28A3",
      "\u28A4",
      "\u28A5",
      "\u28A6",
      "\u28A7",
      "\u28E0",
      "\u28E1",
      "\u28E2",
      "\u28E3",
      "\u28E4",
      "\u28E5",
      "\u28E6",
      "\u28E7",
      "\u28A8",
      "\u28A9",
      "\u28AA",
      "\u28AB",
      "\u28AC",
      "\u28AD",
      "\u28AE",
      "\u28AF",
      "\u28E8",
      "\u28E9",
      "\u28EA",
      "\u28EB",
      "\u28EC",
      "\u28ED",
      "\u28EE",
      "\u28EF",
      "\u28B0",
      "\u28B1",
      "\u28B2",
      "\u28B3",
      "\u28B4",
      "\u28B5",
      "\u28B6",
      "\u28B7",
      "\u28F0",
      "\u28F1",
      "\u28F2",
      "\u28F3",
      "\u28F4",
      "\u28F5",
      "\u28F6",
      "\u28F7",
      "\u28B8",
      "\u28B9",
      "\u28BA",
      "\u28BB",
      "\u28BC",
      "\u28BD",
      "\u28BE",
      "\u28BF",
      "\u28F8",
      "\u28F9",
      "\u28FA",
      "\u28FB",
      "\u28FC",
      "\u28FD",
      "\u28FE",
      "\u28FF"
    ]
  },
  dotsCircle: {
    interval: 80,
    frames: [
      "\u288E ",
      "\u280E\u2801",
      "\u280A\u2811",
      "\u2808\u2831",
      " \u2871",
      "\u2880\u2870",
      "\u2884\u2860",
      "\u2886\u2840"
    ]
  },
  sand: {
    interval: 80,
    frames: [
      "\u2801",
      "\u2802",
      "\u2804",
      "\u2840",
      "\u2848",
      "\u2850",
      "\u2860",
      "\u28C0",
      "\u28C1",
      "\u28C2",
      "\u28C4",
      "\u28CC",
      "\u28D4",
      "\u28E4",
      "\u28E5",
      "\u28E6",
      "\u28EE",
      "\u28F6",
      "\u28F7",
      "\u28FF",
      "\u287F",
      "\u283F",
      "\u289F",
      "\u281F",
      "\u285B",
      "\u281B",
      "\u282B",
      "\u288B",
      "\u280B",
      "\u280D",
      "\u2849",
      "\u2809",
      "\u2811",
      "\u2821",
      "\u2881"
    ]
  },
  line: {
    interval: 130,
    frames: [
      "-",
      "\\",
      "|",
      "/"
    ]
  },
  line2: {
    interval: 100,
    frames: [
      "\u2802",
      "-",
      "\u2013",
      "\u2014",
      "\u2013",
      "-"
    ]
  },
  rollingLine: {
    interval: 80,
    frames: [
      "/  ",
      " - ",
      " \\ ",
      "  |",
      "  |",
      " \\ ",
      " - ",
      "/  "
    ]
  },
  pipe: {
    interval: 100,
    frames: [
      "\u2524",
      "\u2518",
      "\u2534",
      "\u2514",
      "\u251C",
      "\u250C",
      "\u252C",
      "\u2510"
    ]
  },
  simpleDots: {
    interval: 400,
    frames: [
      ".  ",
      ".. ",
      "...",
      "   "
    ]
  },
  simpleDotsScrolling: {
    interval: 200,
    frames: [
      ".  ",
      ".. ",
      "...",
      " ..",
      "  .",
      "   "
    ]
  },
  star: {
    interval: 70,
    frames: [
      "\u2736",
      "\u2738",
      "\u2739",
      "\u273A",
      "\u2739",
      "\u2737"
    ]
  },
  star2: {
    interval: 80,
    frames: [
      "+",
      "x",
      "*"
    ]
  },
  flip: {
    interval: 70,
    frames: [
      "_",
      "_",
      "_",
      "-",
      "`",
      "`",
      "'",
      "\xB4",
      "-",
      "_",
      "_",
      "_"
    ]
  },
  hamburger: {
    interval: 100,
    frames: [
      "\u2631",
      "\u2632",
      "\u2634"
    ]
  },
  growVertical: {
    interval: 120,
    frames: [
      "\u2581",
      "\u2583",
      "\u2584",
      "\u2585",
      "\u2586",
      "\u2587",
      "\u2586",
      "\u2585",
      "\u2584",
      "\u2583"
    ]
  },
  growHorizontal: {
    interval: 120,
    frames: [
      "\u258F",
      "\u258E",
      "\u258D",
      "\u258C",
      "\u258B",
      "\u258A",
      "\u2589",
      "\u258A",
      "\u258B",
      "\u258C",
      "\u258D",
      "\u258E"
    ]
  },
  balloon: {
    interval: 140,
    frames: [
      " ",
      ".",
      "o",
      "O",
      "@",
      "*",
      " "
    ]
  },
  balloon2: {
    interval: 120,
    frames: [
      ".",
      "o",
      "O",
      "\xB0",
      "O",
      "o",
      "."
    ]
  },
  noise: {
    interval: 100,
    frames: [
      "\u2593",
      "\u2592",
      "\u2591"
    ]
  },
  bounce: {
    interval: 120,
    frames: [
      "\u2801",
      "\u2802",
      "\u2804",
      "\u2802"
    ]
  },
  boxBounce: {
    interval: 120,
    frames: [
      "\u2596",
      "\u2598",
      "\u259D",
      "\u2597"
    ]
  },
  boxBounce2: {
    interval: 100,
    frames: [
      "\u258C",
      "\u2580",
      "\u2590",
      "\u2584"
    ]
  },
  triangle: {
    interval: 50,
    frames: [
      "\u25E2",
      "\u25E3",
      "\u25E4",
      "\u25E5"
    ]
  },
  binary: {
    interval: 80,
    frames: [
      "010010",
      "001100",
      "100101",
      "111010",
      "111101",
      "010111",
      "101011",
      "111000",
      "110011",
      "110101"
    ]
  },
  arc: {
    interval: 100,
    frames: [
      "\u25DC",
      "\u25E0",
      "\u25DD",
      "\u25DE",
      "\u25E1",
      "\u25DF"
    ]
  },
  circle: {
    interval: 120,
    frames: [
      "\u25E1",
      "\u2299",
      "\u25E0"
    ]
  },
  squareCorners: {
    interval: 180,
    frames: [
      "\u25F0",
      "\u25F3",
      "\u25F2",
      "\u25F1"
    ]
  },
  circleQuarters: {
    interval: 120,
    frames: [
      "\u25F4",
      "\u25F7",
      "\u25F6",
      "\u25F5"
    ]
  },
  circleHalves: {
    interval: 50,
    frames: [
      "\u25D0",
      "\u25D3",
      "\u25D1",
      "\u25D2"
    ]
  },
  squish: {
    interval: 100,
    frames: [
      "\u256B",
      "\u256A"
    ]
  },
  toggle: {
    interval: 250,
    frames: [
      "\u22B6",
      "\u22B7"
    ]
  },
  toggle2: {
    interval: 80,
    frames: [
      "\u25AB",
      "\u25AA"
    ]
  },
  toggle3: {
    interval: 120,
    frames: [
      "\u25A1",
      "\u25A0"
    ]
  },
  toggle4: {
    interval: 100,
    frames: [
      "\u25A0",
      "\u25A1",
      "\u25AA",
      "\u25AB"
    ]
  },
  toggle5: {
    interval: 100,
    frames: [
      "\u25AE",
      "\u25AF"
    ]
  },
  toggle6: {
    interval: 300,
    frames: [
      "\u101D",
      "\u1040"
    ]
  },
  toggle7: {
    interval: 80,
    frames: [
      "\u29BE",
      "\u29BF"
    ]
  },
  toggle8: {
    interval: 100,
    frames: [
      "\u25CD",
      "\u25CC"
    ]
  },
  toggle9: {
    interval: 100,
    frames: [
      "\u25C9",
      "\u25CE"
    ]
  },
  toggle10: {
    interval: 100,
    frames: [
      "\u3282",
      "\u3280",
      "\u3281"
    ]
  },
  toggle11: {
    interval: 50,
    frames: [
      "\u29C7",
      "\u29C6"
    ]
  },
  toggle12: {
    interval: 120,
    frames: [
      "\u2617",
      "\u2616"
    ]
  },
  toggle13: {
    interval: 80,
    frames: [
      "=",
      "*",
      "-"
    ]
  },
  arrow: {
    interval: 100,
    frames: [
      "\u2190",
      "\u2196",
      "\u2191",
      "\u2197",
      "\u2192",
      "\u2198",
      "\u2193",
      "\u2199"
    ]
  },
  arrow2: {
    interval: 80,
    frames: [
      "\u2B06\uFE0F ",
      "\u2197\uFE0F ",
      "\u27A1\uFE0F ",
      "\u2198\uFE0F ",
      "\u2B07\uFE0F ",
      "\u2199\uFE0F ",
      "\u2B05\uFE0F ",
      "\u2196\uFE0F "
    ]
  },
  arrow3: {
    interval: 120,
    frames: [
      "\u25B9\u25B9\u25B9\u25B9\u25B9",
      "\u25B8\u25B9\u25B9\u25B9\u25B9",
      "\u25B9\u25B8\u25B9\u25B9\u25B9",
      "\u25B9\u25B9\u25B8\u25B9\u25B9",
      "\u25B9\u25B9\u25B9\u25B8\u25B9",
      "\u25B9\u25B9\u25B9\u25B9\u25B8"
    ]
  },
  bouncingBar: {
    interval: 80,
    frames: [
      "[    ]",
      "[=   ]",
      "[==  ]",
      "[=== ]",
      "[====]",
      "[ ===]",
      "[  ==]",
      "[   =]",
      "[    ]",
      "[   =]",
      "[  ==]",
      "[ ===]",
      "[====]",
      "[=== ]",
      "[==  ]",
      "[=   ]"
    ]
  },
  bouncingBall: {
    interval: 80,
    frames: [
      "( \u25CF    )",
      "(  \u25CF   )",
      "(   \u25CF  )",
      "(    \u25CF )",
      "(     \u25CF)",
      "(    \u25CF )",
      "(   \u25CF  )",
      "(  \u25CF   )",
      "( \u25CF    )",
      "(\u25CF     )"
    ]
  },
  smiley: {
    interval: 200,
    frames: [
      "\uD83D\uDE04 ",
      "\uD83D\uDE1D "
    ]
  },
  monkey: {
    interval: 300,
    frames: [
      "\uD83D\uDE48 ",
      "\uD83D\uDE48 ",
      "\uD83D\uDE49 ",
      "\uD83D\uDE4A "
    ]
  },
  hearts: {
    interval: 100,
    frames: [
      "\uD83D\uDC9B ",
      "\uD83D\uDC99 ",
      "\uD83D\uDC9C ",
      "\uD83D\uDC9A ",
      "\uD83D\uDC97 "
    ]
  },
  clock: {
    interval: 100,
    frames: [
      "\uD83D\uDD5B ",
      "\uD83D\uDD50 ",
      "\uD83D\uDD51 ",
      "\uD83D\uDD52 ",
      "\uD83D\uDD53 ",
      "\uD83D\uDD54 ",
      "\uD83D\uDD55 ",
      "\uD83D\uDD56 ",
      "\uD83D\uDD57 ",
      "\uD83D\uDD58 ",
      "\uD83D\uDD59 ",
      "\uD83D\uDD5A "
    ]
  },
  earth: {
    interval: 180,
    frames: [
      "\uD83C\uDF0D ",
      "\uD83C\uDF0E ",
      "\uD83C\uDF0F "
    ]
  },
  material: {
    interval: 17,
    frames: [
      "\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588",
      "\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2588",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581",
      "\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581\u2581"
    ]
  },
  moon: {
    interval: 80,
    frames: [
      "\uD83C\uDF11 ",
      "\uD83C\uDF12 ",
      "\uD83C\uDF13 ",
      "\uD83C\uDF14 ",
      "\uD83C\uDF15 ",
      "\uD83C\uDF16 ",
      "\uD83C\uDF17 ",
      "\uD83C\uDF18 "
    ]
  },
  runner: {
    interval: 140,
    frames: [
      "\uD83D\uDEB6 ",
      "\uD83C\uDFC3 "
    ]
  },
  pong: {
    interval: 80,
    frames: [
      "\u2590\u2802       \u258C",
      "\u2590\u2808       \u258C",
      "\u2590 \u2802      \u258C",
      "\u2590 \u2820      \u258C",
      "\u2590  \u2840     \u258C",
      "\u2590  \u2820     \u258C",
      "\u2590   \u2802    \u258C",
      "\u2590   \u2808    \u258C",
      "\u2590    \u2802   \u258C",
      "\u2590    \u2820   \u258C",
      "\u2590     \u2840  \u258C",
      "\u2590     \u2820  \u258C",
      "\u2590      \u2802 \u258C",
      "\u2590      \u2808 \u258C",
      "\u2590       \u2802\u258C",
      "\u2590       \u2820\u258C",
      "\u2590       \u2840\u258C",
      "\u2590      \u2820 \u258C",
      "\u2590      \u2802 \u258C",
      "\u2590     \u2808  \u258C",
      "\u2590     \u2802  \u258C",
      "\u2590    \u2820   \u258C",
      "\u2590    \u2840   \u258C",
      "\u2590   \u2820    \u258C",
      "\u2590   \u2802    \u258C",
      "\u2590  \u2808     \u258C",
      "\u2590  \u2802     \u258C",
      "\u2590 \u2820      \u258C",
      "\u2590 \u2840      \u258C",
      "\u2590\u2820       \u258C"
    ]
  },
  shark: {
    interval: 120,
    frames: [
      "\u2590|\\____________\u258C",
      "\u2590_|\\___________\u258C",
      "\u2590__|\\__________\u258C",
      "\u2590___|\\_________\u258C",
      "\u2590____|\\________\u258C",
      "\u2590_____|\\_______\u258C",
      "\u2590______|\\______\u258C",
      "\u2590_______|\\_____\u258C",
      "\u2590________|\\____\u258C",
      "\u2590_________|\\___\u258C",
      "\u2590__________|\\__\u258C",
      "\u2590___________|\\_\u258C",
      "\u2590____________|\\\u258C",
      "\u2590____________/|\u258C",
      "\u2590___________/|_\u258C",
      "\u2590__________/|__\u258C",
      "\u2590_________/|___\u258C",
      "\u2590________/|____\u258C",
      "\u2590_______/|_____\u258C",
      "\u2590______/|______\u258C",
      "\u2590_____/|_______\u258C",
      "\u2590____/|________\u258C",
      "\u2590___/|_________\u258C",
      "\u2590__/|__________\u258C",
      "\u2590_/|___________\u258C",
      "\u2590/|____________\u258C"
    ]
  },
  dqpb: {
    interval: 100,
    frames: [
      "d",
      "q",
      "p",
      "b"
    ]
  },
  weather: {
    interval: 100,
    frames: [
      "\u2600\uFE0F ",
      "\u2600\uFE0F ",
      "\u2600\uFE0F ",
      "\uD83C\uDF24 ",
      "\u26C5\uFE0F ",
      "\uD83C\uDF25 ",
      "\u2601\uFE0F ",
      "\uD83C\uDF27 ",
      "\uD83C\uDF28 ",
      "\uD83C\uDF27 ",
      "\uD83C\uDF28 ",
      "\uD83C\uDF27 ",
      "\uD83C\uDF28 ",
      "\u26C8 ",
      "\uD83C\uDF28 ",
      "\uD83C\uDF27 ",
      "\uD83C\uDF28 ",
      "\u2601\uFE0F ",
      "\uD83C\uDF25 ",
      "\u26C5\uFE0F ",
      "\uD83C\uDF24 ",
      "\u2600\uFE0F ",
      "\u2600\uFE0F "
    ]
  },
  christmas: {
    interval: 400,
    frames: [
      "\uD83C\uDF32",
      "\uD83C\uDF84"
    ]
  },
  grenade: {
    interval: 80,
    frames: [
      "\u060C  ",
      "\u2032  ",
      " \xB4 ",
      " \u203E ",
      "  \u2E0C",
      "  \u2E0A",
      "  |",
      "  \u204E",
      "  \u2055",
      " \u0DF4 ",
      "  \u2053",
      "   ",
      "   ",
      "   "
    ]
  },
  point: {
    interval: 125,
    frames: [
      "\u2219\u2219\u2219",
      "\u25CF\u2219\u2219",
      "\u2219\u25CF\u2219",
      "\u2219\u2219\u25CF",
      "\u2219\u2219\u2219"
    ]
  },
  layer: {
    interval: 150,
    frames: [
      "-",
      "=",
      "\u2261"
    ]
  },
  betaWave: {
    interval: 80,
    frames: [
      "\u03C1\u03B2\u03B2\u03B2\u03B2\u03B2\u03B2",
      "\u03B2\u03C1\u03B2\u03B2\u03B2\u03B2\u03B2",
      "\u03B2\u03B2\u03C1\u03B2\u03B2\u03B2\u03B2",
      "\u03B2\u03B2\u03B2\u03C1\u03B2\u03B2\u03B2",
      "\u03B2\u03B2\u03B2\u03B2\u03C1\u03B2\u03B2",
      "\u03B2\u03B2\u03B2\u03B2\u03B2\u03C1\u03B2",
      "\u03B2\u03B2\u03B2\u03B2\u03B2\u03B2\u03C1"
    ]
  },
  fingerDance: {
    interval: 160,
    frames: [
      "\uD83E\uDD18 ",
      "\uD83E\uDD1F ",
      "\uD83D\uDD96 ",
      "\u270B ",
      "\uD83E\uDD1A ",
      "\uD83D\uDC46 "
    ]
  },
  fistBump: {
    interval: 80,
    frames: [
      "\uD83E\uDD1C\u3000\u3000\u3000\u3000\uD83E\uDD1B ",
      "\uD83E\uDD1C\u3000\u3000\u3000\u3000\uD83E\uDD1B ",
      "\uD83E\uDD1C\u3000\u3000\u3000\u3000\uD83E\uDD1B ",
      "\u3000\uD83E\uDD1C\u3000\u3000\uD83E\uDD1B\u3000 ",
      "\u3000\u3000\uD83E\uDD1C\uD83E\uDD1B\u3000\u3000 ",
      "\u3000\uD83E\uDD1C\u2728\uD83E\uDD1B\u3000\u3000 ",
      "\uD83E\uDD1C\u3000\u2728\u3000\uD83E\uDD1B\u3000 "
    ]
  },
  soccerHeader: {
    interval: 80,
    frames: [
      " \uD83E\uDDD1\u26BD\uFE0F       \uD83E\uDDD1 ",
      "\uD83E\uDDD1  \u26BD\uFE0F      \uD83E\uDDD1 ",
      "\uD83E\uDDD1   \u26BD\uFE0F     \uD83E\uDDD1 ",
      "\uD83E\uDDD1    \u26BD\uFE0F    \uD83E\uDDD1 ",
      "\uD83E\uDDD1     \u26BD\uFE0F   \uD83E\uDDD1 ",
      "\uD83E\uDDD1      \u26BD\uFE0F  \uD83E\uDDD1 ",
      "\uD83E\uDDD1       \u26BD\uFE0F\uD83E\uDDD1  ",
      "\uD83E\uDDD1      \u26BD\uFE0F  \uD83E\uDDD1 ",
      "\uD83E\uDDD1     \u26BD\uFE0F   \uD83E\uDDD1 ",
      "\uD83E\uDDD1    \u26BD\uFE0F    \uD83E\uDDD1 ",
      "\uD83E\uDDD1   \u26BD\uFE0F     \uD83E\uDDD1 ",
      "\uD83E\uDDD1  \u26BD\uFE0F      \uD83E\uDDD1 "
    ]
  },
  mindblown: {
    interval: 160,
    frames: [
      "\uD83D\uDE10 ",
      "\uD83D\uDE10 ",
      "\uD83D\uDE2E ",
      "\uD83D\uDE2E ",
      "\uD83D\uDE26 ",
      "\uD83D\uDE26 ",
      "\uD83D\uDE27 ",
      "\uD83D\uDE27 ",
      "\uD83E\uDD2F ",
      "\uD83D\uDCA5 ",
      "\u2728 ",
      "\u3000 ",
      "\u3000 ",
      "\u3000 "
    ]
  },
  speaker: {
    interval: 160,
    frames: [
      "\uD83D\uDD08 ",
      "\uD83D\uDD09 ",
      "\uD83D\uDD0A ",
      "\uD83D\uDD09 "
    ]
  },
  orangePulse: {
    interval: 100,
    frames: [
      "\uD83D\uDD38 ",
      "\uD83D\uDD36 ",
      "\uD83D\uDFE0 ",
      "\uD83D\uDFE0 ",
      "\uD83D\uDD36 "
    ]
  },
  bluePulse: {
    interval: 100,
    frames: [
      "\uD83D\uDD39 ",
      "\uD83D\uDD37 ",
      "\uD83D\uDD35 ",
      "\uD83D\uDD35 ",
      "\uD83D\uDD37 "
    ]
  },
  orangeBluePulse: {
    interval: 100,
    frames: [
      "\uD83D\uDD38 ",
      "\uD83D\uDD36 ",
      "\uD83D\uDFE0 ",
      "\uD83D\uDFE0 ",
      "\uD83D\uDD36 ",
      "\uD83D\uDD39 ",
      "\uD83D\uDD37 ",
      "\uD83D\uDD35 ",
      "\uD83D\uDD35 ",
      "\uD83D\uDD37 "
    ]
  },
  timeTravel: {
    interval: 100,
    frames: [
      "\uD83D\uDD5B ",
      "\uD83D\uDD5A ",
      "\uD83D\uDD59 ",
      "\uD83D\uDD58 ",
      "\uD83D\uDD57 ",
      "\uD83D\uDD56 ",
      "\uD83D\uDD55 ",
      "\uD83D\uDD54 ",
      "\uD83D\uDD53 ",
      "\uD83D\uDD52 ",
      "\uD83D\uDD51 ",
      "\uD83D\uDD50 "
    ]
  },
  aesthetic: {
    interval: 80,
    frames: [
      "\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B0\u25B1\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B0\u25B0\u25B1",
      "\u25B0\u25B0\u25B0\u25B0\u25B0\u25B0\u25B0",
      "\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1"
    ]
  },
  dwarfFortress: {
    interval: 80,
    frames: [
      " \u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2593\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2593\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2592\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2592\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2591\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A\u2591\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "\u263A \u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2593\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2593\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2592\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2592\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2591\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A\u2591\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u263A \u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2593\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2593\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2592\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2592\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2591\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A\u2591\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u263A \u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2593\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2593\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2592\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2592\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2591\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A\u2591\u2588\u2588\xA3\xA3\xA3  ",
      "   \u263A \u2588\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2588\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2588\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2593\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2593\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2592\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2592\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2591\u2588\xA3\xA3\xA3  ",
      "    \u263A\u2591\u2588\xA3\xA3\xA3  ",
      "    \u263A \u2588\xA3\xA3\xA3  ",
      "     \u263A\u2588\xA3\xA3\xA3  ",
      "     \u263A\u2588\xA3\xA3\xA3  ",
      "     \u263A\u2593\xA3\xA3\xA3  ",
      "     \u263A\u2593\xA3\xA3\xA3  ",
      "     \u263A\u2592\xA3\xA3\xA3  ",
      "     \u263A\u2592\xA3\xA3\xA3  ",
      "     \u263A\u2591\xA3\xA3\xA3  ",
      "     \u263A\u2591\xA3\xA3\xA3  ",
      "     \u263A \xA3\xA3\xA3  ",
      "      \u263A\xA3\xA3\xA3  ",
      "      \u263A\xA3\xA3\xA3  ",
      "      \u263A\u2593\xA3\xA3  ",
      "      \u263A\u2593\xA3\xA3  ",
      "      \u263A\u2592\xA3\xA3  ",
      "      \u263A\u2592\xA3\xA3  ",
      "      \u263A\u2591\xA3\xA3  ",
      "      \u263A\u2591\xA3\xA3  ",
      "      \u263A \xA3\xA3  ",
      "       \u263A\xA3\xA3  ",
      "       \u263A\xA3\xA3  ",
      "       \u263A\u2593\xA3  ",
      "       \u263A\u2593\xA3  ",
      "       \u263A\u2592\xA3  ",
      "       \u263A\u2592\xA3  ",
      "       \u263A\u2591\xA3  ",
      "       \u263A\u2591\xA3  ",
      "       \u263A \xA3  ",
      "        \u263A\xA3  ",
      "        \u263A\xA3  ",
      "        \u263A\u2593  ",
      "        \u263A\u2593  ",
      "        \u263A\u2592  ",
      "        \u263A\u2592  ",
      "        \u263A\u2591  ",
      "        \u263A\u2591  ",
      "        \u263A   ",
      "        \u263A  &",
      "        \u263A \u263C&",
      "       \u263A \u263C &",
      "       \u263A\u263C  &",
      "      \u263A\u263C  & ",
      "      \u203C   & ",
      "     \u263A   &  ",
      "    \u203C    &  ",
      "   \u263A    &   ",
      "  \u203C     &   ",
      " \u263A     &    ",
      "\u203C      &    ",
      "      &     ",
      "      &     ",
      "     &   \u2591  ",
      "     &   \u2592  ",
      "    &    \u2593  ",
      "    &    \xA3  ",
      "   &    \u2591\xA3  ",
      "   &    \u2592\xA3  ",
      "  &     \u2593\xA3  ",
      "  &     \xA3\xA3  ",
      " &     \u2591\xA3\xA3  ",
      " &     \u2592\xA3\xA3  ",
      "&      \u2593\xA3\xA3  ",
      "&      \xA3\xA3\xA3  ",
      "      \u2591\xA3\xA3\xA3  ",
      "      \u2592\xA3\xA3\xA3  ",
      "      \u2593\xA3\xA3\xA3  ",
      "      \u2588\xA3\xA3\xA3  ",
      "     \u2591\u2588\xA3\xA3\xA3  ",
      "     \u2592\u2588\xA3\xA3\xA3  ",
      "     \u2593\u2588\xA3\xA3\xA3  ",
      "     \u2588\u2588\xA3\xA3\xA3  ",
      "    \u2591\u2588\u2588\xA3\xA3\xA3  ",
      "    \u2592\u2588\u2588\xA3\xA3\xA3  ",
      "    \u2593\u2588\u2588\xA3\xA3\xA3  ",
      "    \u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2591\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2592\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2593\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "   \u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2591\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2592\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2593\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      "  \u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2591\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2592\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2593\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  ",
      " \u2588\u2588\u2588\u2588\u2588\u2588\xA3\xA3\xA3  "
    ]
  },
  fish: {
    interval: 80,
    frames: [
      "~~~~~~~~~~~~~~~~~~~~",
      "> ~~~~~~~~~~~~~~~~~~",
      "\xBA> ~~~~~~~~~~~~~~~~~",
      "(\xBA> ~~~~~~~~~~~~~~~~",
      "((\xBA> ~~~~~~~~~~~~~~~",
      "<((\xBA> ~~~~~~~~~~~~~~",
      "><((\xBA> ~~~~~~~~~~~~~",
      " ><((\xBA> ~~~~~~~~~~~~",
      "~ ><((\xBA> ~~~~~~~~~~~",
      "~~ <>((\xBA> ~~~~~~~~~~",
      "~~~ ><((\xBA> ~~~~~~~~~",
      "~~~~ <>((\xBA> ~~~~~~~~",
      "~~~~~ ><((\xBA> ~~~~~~~",
      "~~~~~~ <>((\xBA> ~~~~~~",
      "~~~~~~~ ><((\xBA> ~~~~~",
      "~~~~~~~~ <>((\xBA> ~~~~",
      "~~~~~~~~~ ><((\xBA> ~~~",
      "~~~~~~~~~~ <>((\xBA> ~~",
      "~~~~~~~~~~~ ><((\xBA> ~",
      "~~~~~~~~~~~~ <>((\xBA> ",
      "~~~~~~~~~~~~~ ><((\xBA>",
      "~~~~~~~~~~~~~~ <>((\xBA",
      "~~~~~~~~~~~~~~~ ><((",
      "~~~~~~~~~~~~~~~~ <>(",
      "~~~~~~~~~~~~~~~~~ ><",
      "~~~~~~~~~~~~~~~~~~ <",
      "~~~~~~~~~~~~~~~~~~~~"
    ]
  }
};

// ../../node_modules/.bun/cli-spinners@3.4.0/node_modules/cli-spinners/index.js
var cli_spinners_default = spinners_default;
var spinnersList = Object.keys(spinners_default);

// ../../node_modules/.bun/log-symbols@7.0.1/node_modules/log-symbols/symbols.js
var exports_symbols = {};
__export(exports_symbols, {
  warning: () => warning,
  success: () => success,
  info: () => info,
  error: () => error
});

// ../../node_modules/.bun/yoctocolors@2.1.2/node_modules/yoctocolors/base.js
import tty2 from "tty";
var hasColors = tty2?.WriteStream?.prototype?.hasColors?.() ?? false;
var format = (open, close) => {
  if (!hasColors) {
    return (input) => input;
  }
  const openCode = `\x1B[${open}m`;
  const closeCode = `\x1B[${close}m`;
  return (input) => {
    const string = input + "";
    let index = string.indexOf(closeCode);
    if (index === -1) {
      return openCode + string + closeCode;
    }
    let result = openCode;
    let lastIndex = 0;
    const reopenOnNestedClose = close === 22;
    const replaceCode = (reopenOnNestedClose ? closeCode : "") + openCode;
    while (index !== -1) {
      result += string.slice(lastIndex, index) + replaceCode;
      lastIndex = index + closeCode.length;
      index = string.indexOf(closeCode, lastIndex);
    }
    result += string.slice(lastIndex) + closeCode;
    return result;
  };
};
var reset = format(0, 0);
var bold = format(1, 22);
var dim = format(2, 22);
var italic = format(3, 23);
var underline = format(4, 24);
var overline = format(53, 55);
var inverse = format(7, 27);
var hidden = format(8, 28);
var strikethrough = format(9, 29);
var black = format(30, 39);
var red = format(31, 39);
var green = format(32, 39);
var yellow = format(33, 39);
var blue = format(34, 39);
var magenta = format(35, 39);
var cyan = format(36, 39);
var white = format(37, 39);
var gray = format(90, 39);
var bgBlack = format(40, 49);
var bgRed = format(41, 49);
var bgGreen = format(42, 49);
var bgYellow = format(43, 49);
var bgBlue = format(44, 49);
var bgMagenta = format(45, 49);
var bgCyan = format(46, 49);
var bgWhite = format(47, 49);
var bgGray = format(100, 49);
var redBright = format(91, 39);
var greenBright = format(92, 39);
var yellowBright = format(93, 39);
var blueBright = format(94, 39);
var magentaBright = format(95, 39);
var cyanBright = format(96, 39);
var whiteBright = format(97, 39);
var bgRedBright = format(101, 49);
var bgGreenBright = format(102, 49);
var bgYellowBright = format(103, 49);
var bgBlueBright = format(104, 49);
var bgMagentaBright = format(105, 49);
var bgCyanBright = format(106, 49);
var bgWhiteBright = format(107, 49);

// ../../node_modules/.bun/is-unicode-supported@2.1.0/node_modules/is-unicode-supported/index.js
import process6 from "process";
function isUnicodeSupported() {
  const { env: env2 } = process6;
  const { TERM, TERM_PROGRAM } = env2;
  if (process6.platform !== "win32") {
    return TERM !== "linux";
  }
  return Boolean(env2.WT_SESSION) || Boolean(env2.TERMINUS_SUBLIME) || env2.ConEmuTask === "{cmd::Cmder}" || TERM_PROGRAM === "Terminus-Sublime" || TERM_PROGRAM === "vscode" || TERM === "xterm-256color" || TERM === "alacritty" || TERM === "rxvt-unicode" || TERM === "rxvt-unicode-256color" || env2.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}

// ../../node_modules/.bun/log-symbols@7.0.1/node_modules/log-symbols/symbols.js
var _isUnicodeSupported = isUnicodeSupported();
var info = blue(_isUnicodeSupported ? "\u2139" : "i");
var success = green(_isUnicodeSupported ? "\u2714" : "\u221A");
var warning = yellow(_isUnicodeSupported ? "\u26A0" : "\u203C");
var error = red(_isUnicodeSupported ? "\u2716" : "\xD7");
// ../../node_modules/.bun/ansi-regex@6.2.2/node_modules/ansi-regex/index.js
function ansiRegex({ onlyFirst = false } = {}) {
  const ST = "(?:\\u0007|\\u001B\\u005C|\\u009C)";
  const osc = `(?:\\u001B\\][\\s\\S]*?${ST})`;
  const csi = "[\\u001B\\u009B][[\\]()#;?]*(?:\\d{1,4}(?:[;:]\\d{0,4})*)?[\\dA-PR-TZcf-nq-uy=><~]";
  const pattern = `${osc}|${csi}`;
  return new RegExp(pattern, onlyFirst ? undefined : "g");
}

// ../../node_modules/.bun/strip-ansi@7.1.2/node_modules/strip-ansi/index.js
var regex = ansiRegex();
function stripAnsi(string) {
  if (typeof string !== "string") {
    throw new TypeError(`Expected a \`string\`, got \`${typeof string}\``);
  }
  return string.replace(regex, "");
}

// ../../node_modules/.bun/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/lookup.js
function isAmbiguous(x) {
  return x === 161 || x === 164 || x === 167 || x === 168 || x === 170 || x === 173 || x === 174 || x >= 176 && x <= 180 || x >= 182 && x <= 186 || x >= 188 && x <= 191 || x === 198 || x === 208 || x === 215 || x === 216 || x >= 222 && x <= 225 || x === 230 || x >= 232 && x <= 234 || x === 236 || x === 237 || x === 240 || x === 242 || x === 243 || x >= 247 && x <= 250 || x === 252 || x === 254 || x === 257 || x === 273 || x === 275 || x === 283 || x === 294 || x === 295 || x === 299 || x >= 305 && x <= 307 || x === 312 || x >= 319 && x <= 322 || x === 324 || x >= 328 && x <= 331 || x === 333 || x === 338 || x === 339 || x === 358 || x === 359 || x === 363 || x === 462 || x === 464 || x === 466 || x === 468 || x === 470 || x === 472 || x === 474 || x === 476 || x === 593 || x === 609 || x === 708 || x === 711 || x >= 713 && x <= 715 || x === 717 || x === 720 || x >= 728 && x <= 731 || x === 733 || x === 735 || x >= 768 && x <= 879 || x >= 913 && x <= 929 || x >= 931 && x <= 937 || x >= 945 && x <= 961 || x >= 963 && x <= 969 || x === 1025 || x >= 1040 && x <= 1103 || x === 1105 || x === 8208 || x >= 8211 && x <= 8214 || x === 8216 || x === 8217 || x === 8220 || x === 8221 || x >= 8224 && x <= 8226 || x >= 8228 && x <= 8231 || x === 8240 || x === 8242 || x === 8243 || x === 8245 || x === 8251 || x === 8254 || x === 8308 || x === 8319 || x >= 8321 && x <= 8324 || x === 8364 || x === 8451 || x === 8453 || x === 8457 || x === 8467 || x === 8470 || x === 8481 || x === 8482 || x === 8486 || x === 8491 || x === 8531 || x === 8532 || x >= 8539 && x <= 8542 || x >= 8544 && x <= 8555 || x >= 8560 && x <= 8569 || x === 8585 || x >= 8592 && x <= 8601 || x === 8632 || x === 8633 || x === 8658 || x === 8660 || x === 8679 || x === 8704 || x === 8706 || x === 8707 || x === 8711 || x === 8712 || x === 8715 || x === 8719 || x === 8721 || x === 8725 || x === 8730 || x >= 8733 && x <= 8736 || x === 8739 || x === 8741 || x >= 8743 && x <= 8748 || x === 8750 || x >= 8756 && x <= 8759 || x === 8764 || x === 8765 || x === 8776 || x === 8780 || x === 8786 || x === 8800 || x === 8801 || x >= 8804 && x <= 8807 || x === 8810 || x === 8811 || x === 8814 || x === 8815 || x === 8834 || x === 8835 || x === 8838 || x === 8839 || x === 8853 || x === 8857 || x === 8869 || x === 8895 || x === 8978 || x >= 9312 && x <= 9449 || x >= 9451 && x <= 9547 || x >= 9552 && x <= 9587 || x >= 9600 && x <= 9615 || x >= 9618 && x <= 9621 || x === 9632 || x === 9633 || x >= 9635 && x <= 9641 || x === 9650 || x === 9651 || x === 9654 || x === 9655 || x === 9660 || x === 9661 || x === 9664 || x === 9665 || x >= 9670 && x <= 9672 || x === 9675 || x >= 9678 && x <= 9681 || x >= 9698 && x <= 9701 || x === 9711 || x === 9733 || x === 9734 || x === 9737 || x === 9742 || x === 9743 || x === 9756 || x === 9758 || x === 9792 || x === 9794 || x === 9824 || x === 9825 || x >= 9827 && x <= 9829 || x >= 9831 && x <= 9834 || x === 9836 || x === 9837 || x === 9839 || x === 9886 || x === 9887 || x === 9919 || x >= 9926 && x <= 9933 || x >= 9935 && x <= 9939 || x >= 9941 && x <= 9953 || x === 9955 || x === 9960 || x === 9961 || x >= 9963 && x <= 9969 || x === 9972 || x >= 9974 && x <= 9977 || x === 9979 || x === 9980 || x === 9982 || x === 9983 || x === 10045 || x >= 10102 && x <= 10111 || x >= 11094 && x <= 11097 || x >= 12872 && x <= 12879 || x >= 57344 && x <= 63743 || x >= 65024 && x <= 65039 || x === 65533 || x >= 127232 && x <= 127242 || x >= 127248 && x <= 127277 || x >= 127280 && x <= 127337 || x >= 127344 && x <= 127373 || x === 127375 || x === 127376 || x >= 127387 && x <= 127404 || x >= 917760 && x <= 917999 || x >= 983040 && x <= 1048573 || x >= 1048576 && x <= 1114109;
}
function isFullWidth(x) {
  return x === 12288 || x >= 65281 && x <= 65376 || x >= 65504 && x <= 65510;
}
function isWide(x) {
  return x >= 4352 && x <= 4447 || x === 8986 || x === 8987 || x === 9001 || x === 9002 || x >= 9193 && x <= 9196 || x === 9200 || x === 9203 || x === 9725 || x === 9726 || x === 9748 || x === 9749 || x >= 9776 && x <= 9783 || x >= 9800 && x <= 9811 || x === 9855 || x >= 9866 && x <= 9871 || x === 9875 || x === 9889 || x === 9898 || x === 9899 || x === 9917 || x === 9918 || x === 9924 || x === 9925 || x === 9934 || x === 9940 || x === 9962 || x === 9970 || x === 9971 || x === 9973 || x === 9978 || x === 9981 || x === 9989 || x === 9994 || x === 9995 || x === 10024 || x === 10060 || x === 10062 || x >= 10067 && x <= 10069 || x === 10071 || x >= 10133 && x <= 10135 || x === 10160 || x === 10175 || x === 11035 || x === 11036 || x === 11088 || x === 11093 || x >= 11904 && x <= 11929 || x >= 11931 && x <= 12019 || x >= 12032 && x <= 12245 || x >= 12272 && x <= 12287 || x >= 12289 && x <= 12350 || x >= 12353 && x <= 12438 || x >= 12441 && x <= 12543 || x >= 12549 && x <= 12591 || x >= 12593 && x <= 12686 || x >= 12688 && x <= 12773 || x >= 12783 && x <= 12830 || x >= 12832 && x <= 12871 || x >= 12880 && x <= 42124 || x >= 42128 && x <= 42182 || x >= 43360 && x <= 43388 || x >= 44032 && x <= 55203 || x >= 63744 && x <= 64255 || x >= 65040 && x <= 65049 || x >= 65072 && x <= 65106 || x >= 65108 && x <= 65126 || x >= 65128 && x <= 65131 || x >= 94176 && x <= 94180 || x >= 94192 && x <= 94198 || x >= 94208 && x <= 101589 || x >= 101631 && x <= 101662 || x >= 101760 && x <= 101874 || x >= 110576 && x <= 110579 || x >= 110581 && x <= 110587 || x === 110589 || x === 110590 || x >= 110592 && x <= 110882 || x === 110898 || x >= 110928 && x <= 110930 || x === 110933 || x >= 110948 && x <= 110951 || x >= 110960 && x <= 111355 || x >= 119552 && x <= 119638 || x >= 119648 && x <= 119670 || x === 126980 || x === 127183 || x === 127374 || x >= 127377 && x <= 127386 || x >= 127488 && x <= 127490 || x >= 127504 && x <= 127547 || x >= 127552 && x <= 127560 || x === 127568 || x === 127569 || x >= 127584 && x <= 127589 || x >= 127744 && x <= 127776 || x >= 127789 && x <= 127797 || x >= 127799 && x <= 127868 || x >= 127870 && x <= 127891 || x >= 127904 && x <= 127946 || x >= 127951 && x <= 127955 || x >= 127968 && x <= 127984 || x === 127988 || x >= 127992 && x <= 128062 || x === 128064 || x >= 128066 && x <= 128252 || x >= 128255 && x <= 128317 || x >= 128331 && x <= 128334 || x >= 128336 && x <= 128359 || x === 128378 || x === 128405 || x === 128406 || x === 128420 || x >= 128507 && x <= 128591 || x >= 128640 && x <= 128709 || x === 128716 || x >= 128720 && x <= 128722 || x >= 128725 && x <= 128728 || x >= 128732 && x <= 128735 || x === 128747 || x === 128748 || x >= 128756 && x <= 128764 || x >= 128992 && x <= 129003 || x === 129008 || x >= 129292 && x <= 129338 || x >= 129340 && x <= 129349 || x >= 129351 && x <= 129535 || x >= 129648 && x <= 129660 || x >= 129664 && x <= 129674 || x >= 129678 && x <= 129734 || x === 129736 || x >= 129741 && x <= 129756 || x >= 129759 && x <= 129770 || x >= 129775 && x <= 129784 || x >= 131072 && x <= 196605 || x >= 196608 && x <= 262141;
}

// ../../node_modules/.bun/get-east-asian-width@1.4.0/node_modules/get-east-asian-width/index.js
function validate(codePoint) {
  if (!Number.isSafeInteger(codePoint)) {
    throw new TypeError(`Expected a code point, got \`${typeof codePoint}\`.`);
  }
}
function eastAsianWidth(codePoint, { ambiguousAsWide = false } = {}) {
  validate(codePoint);
  if (isFullWidth(codePoint) || isWide(codePoint) || ambiguousAsWide && isAmbiguous(codePoint)) {
    return 2;
  }
  return 1;
}

// ../../node_modules/.bun/string-width@8.1.1/node_modules/string-width/index.js
var segmenter = new Intl.Segmenter;
var zeroWidthClusterRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Format}|\p{Mark}|\p{Surrogate})+$/v;
var leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;
var rgiEmojiRegex = /^\p{RGI_Emoji}$/v;
function baseVisible(segment) {
  return segment.replace(leadingNonPrintingRegex, "");
}
function isZeroWidthCluster(segment) {
  return zeroWidthClusterRegex.test(segment);
}
function trailingHalfwidthWidth(segment, eastAsianWidthOptions) {
  let extra = 0;
  if (segment.length > 1) {
    for (const char of segment.slice(1)) {
      if (char >= "\uFF00" && char <= "\uFFEF") {
        extra += eastAsianWidth(char.codePointAt(0), eastAsianWidthOptions);
      }
    }
  }
  return extra;
}
function stringWidth(input, options = {}) {
  if (typeof input !== "string" || input.length === 0) {
    return 0;
  }
  const {
    ambiguousIsNarrow = true,
    countAnsiEscapeCodes = false
  } = options;
  let string = input;
  if (!countAnsiEscapeCodes) {
    string = stripAnsi(string);
  }
  if (string.length === 0) {
    return 0;
  }
  let width = 0;
  const eastAsianWidthOptions = { ambiguousAsWide: !ambiguousIsNarrow };
  for (const { segment } of segmenter.segment(string)) {
    if (isZeroWidthCluster(segment)) {
      continue;
    }
    if (rgiEmojiRegex.test(segment)) {
      width += 2;
      continue;
    }
    const codePoint = baseVisible(segment).codePointAt(0);
    width += eastAsianWidth(codePoint, eastAsianWidthOptions);
    width += trailingHalfwidthWidth(segment, eastAsianWidthOptions);
  }
  return width;
}

// ../../node_modules/.bun/is-interactive@2.0.0/node_modules/is-interactive/index.js
function isInteractive({ stream = process.stdout } = {}) {
  return Boolean(stream && stream.isTTY && process.env.TERM !== "dumb" && !("CI" in process.env));
}

// ../../node_modules/.bun/stdin-discarder@0.3.1/node_modules/stdin-discarder/index.js
import process7 from "process";
var ASCII_ETX_CODE = 3;

class StdinDiscarder {
  #activeCount = 0;
  #stdin;
  #stdinWasPaused = false;
  #stdinWasRaw = false;
  #handleInputBound = (chunk) => {
    if (!chunk?.length) {
      return;
    }
    const code = typeof chunk === "string" ? chunk.codePointAt(0) : chunk[0];
    if (code === ASCII_ETX_CODE) {
      if (process7.listenerCount("SIGINT") > 0) {
        process7.emit("SIGINT");
      } else {
        process7.kill(process7.pid, "SIGINT");
      }
    }
  };
  start() {
    this.#activeCount++;
    if (this.#activeCount === 1) {
      this.#realStart();
    }
  }
  stop() {
    if (this.#activeCount === 0) {
      return;
    }
    if (--this.#activeCount === 0) {
      this.#realStop();
    }
  }
  #realStart() {
    const { stdin } = process7;
    if (process7.platform === "win32" || !stdin?.isTTY || typeof stdin.setRawMode !== "function") {
      this.#stdin = undefined;
      return;
    }
    this.#stdin = stdin;
    this.#stdinWasPaused = stdin.isPaused();
    this.#stdinWasRaw = Boolean(stdin.isRaw);
    stdin.setRawMode(true);
    stdin.prependListener("data", this.#handleInputBound);
    if (this.#stdinWasPaused) {
      stdin.resume();
    }
  }
  #realStop() {
    if (!this.#stdin) {
      return;
    }
    const stdin = this.#stdin;
    stdin.off("data", this.#handleInputBound);
    if (stdin.isTTY) {
      stdin.setRawMode?.(this.#stdinWasRaw);
    }
    if (this.#stdinWasPaused) {
      stdin.pause();
    }
    this.#stdin = undefined;
    this.#stdinWasPaused = false;
    this.#stdinWasRaw = false;
  }
}
var stdinDiscarder = new StdinDiscarder;
var stdin_discarder_default = Object.freeze(stdinDiscarder);

// ../../node_modules/.bun/ora@9.3.0/node_modules/ora/index.js
var RENDER_DEFERRAL_TIMEOUT = 200;
var SYNCHRONIZED_OUTPUT_ENABLE = "\x1B[?2026h";
var SYNCHRONIZED_OUTPUT_DISABLE = "\x1B[?2026l";
var activeHooksPerStream = new Map;

class Ora {
  #linesToClear = 0;
  #frameIndex = -1;
  #lastFrameTime = 0;
  #options;
  #spinner;
  #stream;
  #id;
  #hookedStreams = new Map;
  #isInternalWrite = false;
  #drainHandler;
  #deferRenderTimer;
  #isDiscardingStdin = false;
  color;
  #internalWrite(fn) {
    this.#isInternalWrite = true;
    try {
      return fn();
    } finally {
      this.#isInternalWrite = false;
    }
  }
  #tryRender() {
    if (this.isSpinning) {
      this.render();
    }
  }
  #stringifyChunk(chunk, encoding) {
    if (chunk === undefined || chunk === null) {
      return "";
    }
    if (typeof chunk === "string") {
      return chunk;
    }
    if (Buffer.isBuffer(chunk) || ArrayBuffer.isView(chunk)) {
      const normalizedEncoding = typeof encoding === "string" && encoding && encoding !== "buffer" ? encoding : "utf8";
      return Buffer.from(chunk).toString(normalizedEncoding);
    }
    return String(chunk);
  }
  #chunkTerminatesLine(chunkString) {
    if (!chunkString) {
      return false;
    }
    const lastCharacter = chunkString.at(-1);
    return lastCharacter === `
` || lastCharacter === "\r";
  }
  #scheduleRenderDeferral() {
    if (this.#deferRenderTimer) {
      return;
    }
    this.#deferRenderTimer = setTimeout(() => {
      this.#deferRenderTimer = undefined;
      if (this.isSpinning) {
        this.#tryRender();
      }
    }, RENDER_DEFERRAL_TIMEOUT);
    if (typeof this.#deferRenderTimer?.unref === "function") {
      this.#deferRenderTimer.unref();
    }
  }
  #clearRenderDeferral() {
    if (this.#deferRenderTimer) {
      clearTimeout(this.#deferRenderTimer);
      this.#deferRenderTimer = undefined;
    }
  }
  #buildOutputLine(symbol, text, prefixText, suffixText) {
    const fullPrefixText = this.#getFullPrefixText(prefixText, " ");
    const separatorText = symbol ? " " : "";
    const fullText = typeof text === "string" ? separatorText + text : "";
    const fullSuffixText = this.#getFullSuffixText(suffixText, " ");
    return fullPrefixText + symbol + fullText + fullSuffixText;
  }
  constructor(options) {
    if (typeof options === "string") {
      options = {
        text: options
      };
    }
    this.#options = {
      color: "cyan",
      stream: process8.stderr,
      discardStdin: true,
      hideCursor: true,
      ...options
    };
    this.color = this.#options.color;
    this.#stream = this.#options.stream;
    if (typeof this.#options.isEnabled !== "boolean") {
      this.#options.isEnabled = isInteractive({ stream: this.#stream });
    }
    if (typeof this.#options.isSilent !== "boolean") {
      this.#options.isSilent = false;
    }
    const userInterval = this.#options.interval;
    this.spinner = this.#options.spinner;
    this.#options.interval = userInterval;
    this.text = this.#options.text;
    this.prefixText = this.#options.prefixText;
    this.suffixText = this.#options.suffixText;
    this.indent = this.#options.indent;
    if (process8.env.NODE_ENV === "test") {
      this._stream = this.#stream;
      this._isEnabled = this.#options.isEnabled;
      Object.defineProperty(this, "_linesToClear", {
        get() {
          return this.#linesToClear;
        },
        set(newValue) {
          this.#linesToClear = newValue;
        }
      });
      Object.defineProperty(this, "_frameIndex", {
        get() {
          return this.#frameIndex;
        }
      });
      Object.defineProperty(this, "_lineCount", {
        get() {
          const columns = this.#stream.columns ?? 80;
          const prefixText = typeof this.#options.prefixText === "function" ? "" : this.#options.prefixText;
          const suffixText = typeof this.#options.suffixText === "function" ? "" : this.#options.suffixText;
          const fullPrefixText = typeof prefixText === "string" && prefixText !== "" ? prefixText + " " : "";
          const fullSuffixText = typeof suffixText === "string" && suffixText !== "" ? " " + suffixText : "";
          const spinnerChar = "-";
          const fullText = " ".repeat(this.#options.indent) + fullPrefixText + spinnerChar + (typeof this.#options.text === "string" ? " " + this.#options.text : "") + fullSuffixText;
          return this.#computeLineCountFrom(fullText, columns);
        }
      });
    }
  }
  get indent() {
    return this.#options.indent;
  }
  set indent(indent = 0) {
    if (!(indent >= 0 && Number.isInteger(indent))) {
      throw new Error("The `indent` option must be an integer from 0 and up");
    }
    this.#options.indent = indent;
  }
  get interval() {
    return this.#options.interval ?? this.#spinner.interval ?? 100;
  }
  get spinner() {
    return this.#spinner;
  }
  set spinner(spinner) {
    this.#frameIndex = -1;
    this.#options.interval = undefined;
    if (typeof spinner === "object") {
      if (!Array.isArray(spinner.frames) || spinner.frames.length === 0 || spinner.frames.some((frame) => typeof frame !== "string")) {
        throw new Error("The given spinner must have a non-empty `frames` array of strings");
      }
      if (spinner.interval !== undefined && !(Number.isInteger(spinner.interval) && spinner.interval > 0)) {
        throw new Error("`spinner.interval` must be a positive integer if provided");
      }
      this.#spinner = spinner;
    } else if (!isUnicodeSupported()) {
      this.#spinner = cli_spinners_default.line;
    } else if (spinner === undefined) {
      this.#spinner = cli_spinners_default.dots;
    } else if (spinner !== "default" && cli_spinners_default[spinner]) {
      this.#spinner = cli_spinners_default[spinner];
    } else {
      throw new Error(`There is no built-in spinner named '${spinner}'. See https://github.com/sindresorhus/cli-spinners/blob/main/spinners.json for a full list.`);
    }
  }
  get text() {
    return this.#options.text;
  }
  set text(value = "") {
    this.#options.text = value;
  }
  get prefixText() {
    return this.#options.prefixText;
  }
  set prefixText(value = "") {
    this.#options.prefixText = value;
  }
  get suffixText() {
    return this.#options.suffixText;
  }
  set suffixText(value = "") {
    this.#options.suffixText = value;
  }
  get isSpinning() {
    return this.#id !== undefined;
  }
  #formatAffix(value, separator, placeBefore = false) {
    const resolved = typeof value === "function" ? value() : value;
    if (typeof resolved === "string" && resolved !== "") {
      return placeBefore ? separator + resolved : resolved + separator;
    }
    return "";
  }
  #getFullPrefixText(prefixText = this.#options.prefixText, postfix = " ") {
    return this.#formatAffix(prefixText, postfix, false);
  }
  #getFullSuffixText(suffixText = this.#options.suffixText, prefix = " ") {
    return this.#formatAffix(suffixText, prefix, true);
  }
  #computeLineCountFrom(text, columns) {
    let count = 0;
    for (const line of stripVTControlCharacters(text).split(`
`)) {
      count += Math.max(1, Math.ceil(stringWidth(line) / columns));
    }
    return count;
  }
  get isEnabled() {
    return this.#options.isEnabled && !this.#options.isSilent;
  }
  set isEnabled(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("The `isEnabled` option must be a boolean");
    }
    this.#options.isEnabled = value;
  }
  get isSilent() {
    return this.#options.isSilent;
  }
  set isSilent(value) {
    if (typeof value !== "boolean") {
      throw new TypeError("The `isSilent` option must be a boolean");
    }
    this.#options.isSilent = value;
  }
  frame() {
    const now = Date.now();
    if (this.#frameIndex === -1 || now - this.#lastFrameTime >= this.interval) {
      this.#frameIndex = (this.#frameIndex + 1) % this.#spinner.frames.length;
      this.#lastFrameTime = now;
    }
    const { frames } = this.#spinner;
    let frame = frames[this.#frameIndex];
    if (this.color) {
      frame = source_default[this.color](frame);
    }
    const fullPrefixText = this.#getFullPrefixText(this.#options.prefixText, " ");
    const fullText = typeof this.text === "string" ? " " + this.text : "";
    const fullSuffixText = this.#getFullSuffixText(this.#options.suffixText, " ");
    return fullPrefixText + frame + fullText + fullSuffixText;
  }
  clear() {
    if (!this.isEnabled || !this.#stream.isTTY) {
      return this;
    }
    this.#internalWrite(() => {
      this.#stream.cursorTo(0);
      for (let index = 0;index < this.#linesToClear; index++) {
        if (index > 0) {
          this.#stream.moveCursor(0, -1);
        }
        this.#stream.clearLine(1);
      }
      if (this.#options.indent) {
        this.#stream.cursorTo(this.#options.indent);
      }
    });
    this.#linesToClear = 0;
    return this;
  }
  #hookStream(stream) {
    if (!stream || this.#hookedStreams.has(stream) || !stream.isTTY || typeof stream.write !== "function") {
      return;
    }
    if (activeHooksPerStream.has(stream)) {
      console.warn("[ora] Multiple concurrent spinners detected. This may cause visual corruption. Use one spinner at a time.");
    }
    const originalWrite = stream.write;
    this.#hookedStreams.set(stream, originalWrite);
    activeHooksPerStream.set(stream, this);
    stream.write = (chunk, encoding, callback) => this.#hookedWrite(stream, originalWrite, chunk, encoding, callback);
  }
  #installHook() {
    if (!this.isEnabled || this.#hookedStreams.size > 0) {
      return;
    }
    const streamsToHook = new Set([this.#stream, process8.stdout, process8.stderr]);
    for (const stream of streamsToHook) {
      this.#hookStream(stream);
    }
  }
  #uninstallHook() {
    for (const [stream, originalWrite] of this.#hookedStreams) {
      stream.write = originalWrite;
      if (activeHooksPerStream.get(stream) === this) {
        activeHooksPerStream.delete(stream);
      }
    }
    this.#hookedStreams.clear();
  }
  #hookedWrite(stream, originalWrite, chunk, encoding, callback) {
    if (typeof encoding === "function") {
      callback = encoding;
      encoding = undefined;
    }
    if (this.#isInternalWrite) {
      return originalWrite.call(stream, chunk, encoding, callback);
    }
    this.clear();
    const chunkString = this.#stringifyChunk(chunk, encoding);
    const chunkTerminatesLine = this.#chunkTerminatesLine(chunkString);
    const writeResult = originalWrite.call(stream, chunk, encoding, callback);
    if (chunkTerminatesLine) {
      this.#clearRenderDeferral();
    } else if (chunkString.length > 0) {
      this.#scheduleRenderDeferral();
    }
    if (this.isSpinning && !this.#deferRenderTimer) {
      this.render();
    }
    return writeResult;
  }
  render() {
    if (!this.isEnabled || this.#drainHandler || this.#deferRenderTimer) {
      return this;
    }
    const useSynchronizedOutput = this.#stream.isTTY;
    let shouldDisableSynchronizedOutput = false;
    try {
      if (useSynchronizedOutput) {
        this.#internalWrite(() => this.#stream.write(SYNCHRONIZED_OUTPUT_ENABLE));
        shouldDisableSynchronizedOutput = true;
      }
      this.clear();
      let frameContent = this.frame();
      const columns = this.#stream.columns ?? 80;
      const actualLineCount = this.#computeLineCountFrom(frameContent, columns);
      const consoleHeight = this.#stream.rows;
      if (consoleHeight && consoleHeight > 1 && actualLineCount > consoleHeight) {
        const lines = frameContent.split(`
`);
        const maxLines = consoleHeight - 1;
        frameContent = [...lines.slice(0, maxLines), "... (content truncated to fit terminal)"].join(`
`);
      }
      const canContinue = this.#internalWrite(() => this.#stream.write(frameContent));
      if (canContinue === false && this.#stream.isTTY) {
        this.#drainHandler = () => {
          this.#drainHandler = undefined;
          this.#tryRender();
        };
        this.#stream.once("drain", this.#drainHandler);
      }
      this.#linesToClear = this.#computeLineCountFrom(frameContent, columns);
    } finally {
      if (shouldDisableSynchronizedOutput) {
        this.#internalWrite(() => this.#stream.write(SYNCHRONIZED_OUTPUT_DISABLE));
      }
    }
    return this;
  }
  start(text) {
    if (text) {
      this.text = text;
    }
    if (this.isSilent) {
      return this;
    }
    if (!this.isEnabled) {
      const symbol = this.text ? "-" : "";
      const line = " ".repeat(this.#options.indent) + this.#buildOutputLine(symbol, this.text, this.#options.prefixText, this.#options.suffixText);
      if (line.trim() !== "") {
        this.#internalWrite(() => this.#stream.write(line + `
`));
      }
      return this;
    }
    if (this.isSpinning) {
      return this;
    }
    if (this.#options.hideCursor) {
      cli_cursor_default.hide(this.#stream);
    }
    if (this.#options.discardStdin && process8.stdin.isTTY) {
      stdin_discarder_default.start();
      this.#isDiscardingStdin = true;
    }
    this.#installHook();
    this.render();
    this.#id = setInterval(this.render.bind(this), this.interval);
    return this;
  }
  stop() {
    clearInterval(this.#id);
    this.#id = undefined;
    this.#frameIndex = -1;
    this.#lastFrameTime = 0;
    this.#clearRenderDeferral();
    this.#uninstallHook();
    if (this.#drainHandler) {
      this.#stream.removeListener("drain", this.#drainHandler);
      this.#drainHandler = undefined;
    }
    if (this.isEnabled) {
      this.clear();
      if (this.#options.hideCursor) {
        cli_cursor_default.show(this.#stream);
      }
    }
    if (this.#isDiscardingStdin) {
      this.#isDiscardingStdin = false;
      stdin_discarder_default.stop();
    }
    return this;
  }
  succeed(text) {
    return this.stopAndPersist({ symbol: exports_symbols.success, text });
  }
  fail(text) {
    return this.stopAndPersist({ symbol: exports_symbols.error, text });
  }
  warn(text) {
    return this.stopAndPersist({ symbol: exports_symbols.warning, text });
  }
  info(text) {
    return this.stopAndPersist({ symbol: exports_symbols.info, text });
  }
  stopAndPersist(options = {}) {
    if (this.isSilent) {
      return this;
    }
    const symbol = options.symbol ?? " ";
    const text = options.text ?? this.text;
    const prefixText = options.prefixText ?? this.#options.prefixText;
    const suffixText = options.suffixText ?? this.#options.suffixText;
    const textToWrite = this.#buildOutputLine(symbol, text, prefixText, suffixText) + `
`;
    this.stop();
    this.#internalWrite(() => this.#stream.write(textToWrite));
    return this;
  }
}
function ora(options) {
  return new Ora(options);
}

// src/progress.ts
function createProgressReporter() {
  let spinner = null;
  const completed = [];
  return {
    onProgress(event) {
      if (event.type === "started") {
        console.log(`
Running ${event.agentCount} agents...
`);
      }
      if (event.type === "agent-started") {
        spinner = ora(`Analyzing: ${event.agent}`).start();
      }
      if (event.type === "agent-completed") {
        if (spinner) {
          spinner.stop();
          spinner = null;
        }
        const duration = event.duration?.toFixed(1) || "0.0";
        const score = event.score?.toFixed(1) || "0.0";
        console.log(`  \u2713 ${event.agent?.padEnd(15)} [${duration}s] Score: ${score}/10`);
        if (event.agent) {
          completed.push(event.agent);
        }
      }
      if (event.type === "completed") {
        const duration = event.totalDuration?.toFixed(1) || "0.0";
        console.log(`
Completed in ${duration}s
`);
      }
    },
    get isSpinning() {
      return spinner !== null;
    },
    getCompleted() {
      return [...completed];
    }
  };
}

// src/validation.ts
import { existsSync as existsSync2 } from "fs";
import { resolve as resolve3 } from "path";

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
  }
}
function validateInput(path) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new ValidationError("API key (ANTHROPIC_API_KEY) environment variable is required");
  }
  const absolutePath = resolve3(path);
  if (!existsSync2(absolutePath)) {
    throw new ValidationError(`Path does not exist: ${absolutePath}`);
  }
  return absolutePath;
}

// src/errors.ts
function formatError(error2) {
  if (error2.name === "RateLimitError") {
    const retryAfter = error2.retryAfter || 60;
    return `
\u2717 Rate Limit Exceeded

  You've hit the API rate limit.

  Solutions:
  \u2022 Wait ${retryAfter} seconds and try again
  \u2022 Reduce audit scope with .gitignore
  \u2022 Upgrade your Anthropic API tier

  Learn more: https://docs.anthropic.com/rate-limits
`;
  }
  if (error2.name === "AuthenticationError") {
    const helpUrl = error2.helpUrl || "https://console.anthropic.com/";
    return `
\u2717 Authentication Failed

  Your API key is invalid or missing.

  Solutions:
  \u2022 Check ANTHROPIC_API_KEY environment variable
  \u2022 Get a new key: ${helpUrl}
  \u2022 Run: export ANTHROPIC_API_KEY=your-key-here
`;
  }
  if (error2.name === "ValidationError") {
    return `
\u2717 Validation Error

  ${error2.message || "Invalid input"}

  Check your input and try again.
`;
  }
  return `
\u2717 Error

  ${error2.message || "An unknown error occurred"}

  If this persists, please report: https://github.com/yourusername/ai-code-auditor/issues
`;
}

// src/cli.ts
function getVersion() {
  try {
    if (typeof Bun !== "undefined" && Bun.main === import.meta.path) {
      const pkgPath = resolve4(dirname(fileURLToPath(import.meta.url)), "../package.json");
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
  } catch (error2) {
    console.error("Error parsing arguments:", error2 instanceof Error ? error2.message : String(error2));
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
    const validatedPath = validateInput(args.path);
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
    console.log(`Discovering files in: ${validatedPath}`);
    const files = await discoverFiles(validatedPath);
    console.log(`  Found ${files.length} file${files.length === 1 ? "" : "s"}`);
    const totalSize = files.reduce((sum, f) => sum + f.size, 0);
    console.log(`  Total size: ${(totalSize / 1024).toFixed(2)} KB`);
    console.log();
    console.log("Creating chunks...");
    const chunks = createChunks(files, config.maxTokensPerChunk);
    console.log(formatChunkSummary(chunks));
    console.log();
    const startTime = Date.now();
    const reporter = createProgressReporter();
    const agentResults = await runAudit(files, {
      model: config.model,
      maxTokens: 4096,
      onProgress: reporter.onProgress
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
  } catch (error2) {
    console.error(formatError(error2 instanceof Error ? error2 : new Error(String(error2))));
    process.exit(1);
  }
}
main();
