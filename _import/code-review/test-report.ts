#!/usr/bin/env bun

/**
 * Test script for report generation with mock data
 * Run: bun run test-report.ts
 */

import { synthesizeReport } from "./src/report/synthesizer.ts";
import { printReport } from "./src/report/terminal.ts";
import { generateMarkdown } from "./src/report/markdown.ts";
import type { AgentResult } from "./src/agents/types.ts";

// Mock agent results
const mockResults: AgentResult[] = [
  {
    agent: "correctness",
    score: 8.5,
    findings: [
      {
        severity: "info",
        title: "Minor type annotation opportunity",
        description: "Function return type could be explicitly annotated",
        file: "src/auth.ts",
        line: 25,
        suggestion: "Add explicit return type annotation",
      },
    ],
    summary: "Code logic is correct with minor type improvement opportunities",
    durationMs: 142,
  },
  {
    agent: "security",
    score: 6.0,
    findings: [
      {
        severity: "critical",
        title: "SQL injection vulnerability",
        description: "User input directly concatenated into SQL query without sanitization",
        file: "src/auth.ts",
        line: 42,
        suggestion: "Use parameterized queries with prepared statements",
      },
      {
        severity: "critical",
        title: "Hardcoded credentials",
        description: "API key stored as plaintext in source code",
        file: "src/config.ts",
        line: 15,
        suggestion: "Move to environment variables and add to .gitignore",
      },
      {
        severity: "warning",
        title: "Missing rate limiting",
        description: "Login endpoint has no rate limiting, vulnerable to brute force",
        file: "src/auth.ts",
        line: 30,
        suggestion: "Implement rate limiting middleware (e.g., express-rate-limit)",
      },
    ],
    summary: "Two critical security vulnerabilities requiring immediate attention",
    durationMs: 156,
  },
  {
    agent: "performance",
    score: 7.8,
    findings: [
      {
        severity: "warning",
        title: "N+1 query pattern",
        description: "Database query executed inside loop, causing N+1 queries",
        file: "src/users.ts",
        line: 89,
        suggestion: "Use batch query or SQL JOIN to fetch all data at once",
      },
      {
        severity: "info",
        title: "Consider caching user data",
        description: "User data fetched on every request without caching",
        file: "src/users.ts",
        line: 45,
        suggestion: "Add Redis or in-memory cache for frequently accessed users",
      },
    ],
    summary: "Generally good performance with one query optimization opportunity",
    durationMs: 134,
  },
  {
    agent: "maintainability",
    score: 8.2,
    findings: [
      {
        severity: "warning",
        title: "Complex function",
        description: "Function exceeds 50 lines and has cyclomatic complexity of 12",
        file: "src/auth.ts",
        line: 120,
        suggestion: "Extract validation logic into separate functions",
      },
      {
        severity: "info",
        title: "Missing JSDoc comments",
        description: "Public API functions lack documentation",
        file: "src/auth.ts",
        line: 1,
        suggestion: "Add JSDoc comments describing parameters and return values",
      },
    ],
    summary: "Well-structured code with minor maintainability improvements",
    durationMs: 148,
  },
  {
    agent: "edge-cases",
    score: 5.9,
    findings: [
      {
        severity: "warning",
        title: "No null check",
        description: "User object assumed to exist without null/undefined check",
        file: "src/auth.ts",
        line: 67,
        suggestion: "Add: if (!user) { return null; }",
      },
      {
        severity: "info",
        title: "Missing timeout handling",
        description: "Database connection has no timeout, may hang indefinitely",
        file: "src/auth.ts",
        line: 85,
        suggestion: "Add timeout parameter to database configuration",
      },
    ],
    summary: "Several edge cases not properly handled",
    durationMs: 151,
  },
];

// Generate report
console.log("Testing report generation with mock data...\n");

const report = synthesizeReport("src/auth.ts", mockResults);

// Print to terminal
console.log("=== TERMINAL OUTPUT ===\n");
printReport(report);

// Generate markdown
console.log("\n\n=== MARKDOWN OUTPUT ===\n");
const markdown = generateMarkdown(report);
console.log(markdown);

// Verify calculations
console.log("\n=== VERIFICATION ===\n");
console.log(`Overall Score: ${report.overallScore.toFixed(2)} (expected: ~7.2)`);
console.log(`Critical Findings: ${report.criticalCount} (expected: 2)`);
console.log(`Warning Findings: ${report.warningCount} (expected: 5)`);
console.log(`Info Findings: ${report.infoCount} (expected: 3)`);
console.log(`Top Recommendations: ${report.topRecommendations.length} (expected: 5)`);
console.log("\n✓ Report generation test complete!");
