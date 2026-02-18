import type { FileContent } from "../agents/types";
import type { AuditFinding, AuditTaskResult, AuditSeverity } from "./findings";
import type { AuditTask, Rule, CrossCuttingPattern, Ruleset } from "./types";

// ── File formatting ──

/**
 * Format files with line numbers for inclusion in prompts.
 * Matches the existing agent convention: `lineNumber→content`
 */
function formatFiles(files: FileContent[]): string {
  return files
    .map((file) => {
      const numbered = file.content
        .split("\n")
        .map((line, i) => `${i + 1}→${line}`)
        .join("\n");
      return `File: ${file.relativePath}\nLanguage: ${file.language}\n\n${numbered}`;
    })
    .join("\n\n---\n\n");
}

// ── Rule formatting ──

/**
 * Format a single rule as a prompt section.
 */
function formatRule(rule: Rule): string {
  const lines = [
    `### ${rule.id}: ${rule.title}`,
    `**Severity:** ${rule.severity}`,
    `**Applies to:** ${rule.appliesTo.join(", ")}`,
    "",
    `**Compliant:** ${rule.compliant}`,
    "",
    `**Violation:** ${rule.violation}`,
  ];

  if (rule.whatToLookFor.length > 0) {
    lines.push("", "**What to look for:**");
    for (const item of rule.whatToLookFor) {
      lines.push(`- ${item}`);
    }
  }

  if (rule.guidance) {
    lines.push("", `**Guidance:** ${rule.guidance}`);
  }

  return lines.join("\n");
}

/**
 * Format a cross-cutting pattern as a prompt section.
 */
function formatCrossCuttingPattern(pattern: CrossCuttingPattern): string {
  const lines = [
    `### ${pattern.id}: ${pattern.title}`,
    `**Scope:** ${pattern.scope}`,
    `**Related rules:** ${pattern.relatesTo.join(", ")}`,
    "",
    `**Objective:** ${pattern.objective}`,
  ];

  if (pattern.checks.length > 0) {
    lines.push("", "**What to verify:**");
    for (const check of pattern.checks) {
      lines.push(`- ${check}`);
    }
  }

  return lines.join("\n");
}

// ── Output schema ──

/**
 * JSON Schema for structured output (constrained decoding via --json-schema).
 * Guarantees the model emits valid JSON matching this schema.
 */
export const AUDIT_FINDINGS_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ruleId: { type: "string" },
          severity: {
            type: "string",
            enum: ["critical", "high", "medium", "low", "informational"],
          },
          title: { type: "string" },
          description: { type: "string" },
          locations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                file: { type: "string" },
                startLine: { type: "number" },
                endLine: { type: "number" },
              },
              required: ["file", "startLine"],
              additionalProperties: false,
            },
          },
          evidence: { type: "string" },
          remediation: { type: "string" },
          confidence: { type: "number" },
        },
        required: [
          "ruleId",
          "severity",
          "title",
          "description",
          "locations",
          "evidence",
          "remediation",
          "confidence",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

/** Human-readable schema description embedded in prompts for the model's benefit. */
const FINDING_SCHEMA = `{
  "ruleId": "<rule ID from the rules above, e.g. BAC-01>",
  "severity": "critical" | "high" | "medium" | "low" | "informational",
  "title": "<what's wrong, <80 chars>",
  "description": "<why this is a compliance concern>",
  "locations": [
    { "file": "<relative path>", "startLine": <number>, "endLine": <number or omit> }
  ],
  "evidence": "<the specific code pattern or behavior observed>",
  "remediation": "<concrete fix or approach>",
  "confidence": <0.0-1.0, your confidence this is a real violation>
}`;

// ── System prompts ──

/**
 * Generate the system prompt for a component scan task.
 */
function componentScanSystemPrompt(rules: Rule[], framework: string): string {
  const rulesSection = rules.map(formatRule).join("\n\n");

  return `You are a compliance auditor analyzing code against the ${framework} framework.

## Your Role
Analyze the provided code for violations of the specific compliance rules listed below. You are checking whether the code meets the requirements of each rule — not performing a general code review.

## Rules to Check

${rulesSection}

## Instructions
1. For each rule, examine the code for the specific patterns described in "What to look for"
2. Apply the "Guidance" to avoid false positives
3. Only report findings you are confident about (>70% confidence)
4. Use the exact rule ID from the rules above in each finding
5. If a rule is not applicable to the provided code, do not report findings for it
6. Reference specific line numbers in the code

## Output Format
Return a JSON object with a "findings" array. Each finding must match this schema:

${FINDING_SCHEMA}

If no violations are found, return: {"findings": []}

Return JSON only, no markdown fences, no explanatory text outside the JSON.`;
}

/**
 * Generate the system prompt for a cross-cutting analysis task.
 */
function crossCuttingSystemPrompt(
  pattern: CrossCuttingPattern,
  relatedRules: Rule[],
  framework: string,
): string {
  const relatedSection =
    relatedRules.length > 0
      ? `\n## Related Rules\n\n${relatedRules.map(formatRule).join("\n\n")}`
      : "";

  return `You are a compliance auditor performing cross-cutting analysis against the ${framework} framework.

## Your Role
Perform the analysis described below. This is a cross-cutting concern that spans multiple files and components — you are tracing behaviors across the codebase, not reviewing individual files in isolation.

## Analysis Task

${formatCrossCuttingPattern(pattern)}
${relatedSection}

## Instructions
1. Trace the concern across all provided files
2. Look for the specific checks listed under "What to verify"
3. For data flow analysis, report each location in the flow as a separate location entry
4. Reference related rule IDs where applicable
5. Use "${pattern.id}" as the ruleId for findings specific to this cross-cutting pattern
6. Only report findings you are confident about (>70% confidence)

## Output Format
Return a JSON object with a "findings" array. Each finding must match this schema:

${FINDING_SCHEMA}

If no violations are found, return: {"findings": []}

Return JSON only, no markdown fences, no explanatory text outside the JSON.`;
}

// ── User prompts ──

/**
 * Generate the user prompt for a component scan or cross-cutting task.
 */
function auditUserPrompt(files: FileContent[], task: AuditTask): string {
  const filesSection = formatFiles(files);
  const context = task.component ? `Component: ${task.component}\n` : "";

  return `${context}Analyze the following code for compliance violations per the rules in your system prompt.

${filesSection}

Return your findings as JSON.`;
}

// ── Public API ──

export interface AuditPrompt {
  systemPrompt: string;
  userPrompt: string;
}

/**
 * Generate prompts for a component scan task.
 */
export function generateComponentScanPrompt(
  task: AuditTask,
  files: FileContent[],
  ruleset: Ruleset,
): AuditPrompt {
  const rules = ruleset.rules.filter((r) => task.rules.includes(r.id));

  return {
    systemPrompt: componentScanSystemPrompt(rules, ruleset.meta.framework),
    userPrompt: auditUserPrompt(files, task),
  };
}

/**
 * Generate prompts for a cross-cutting analysis task.
 */
export function generateCrossCuttingPrompt(
  task: AuditTask,
  files: FileContent[],
  ruleset: Ruleset,
): AuditPrompt {
  // The first rule ID in a cross-cutting task is the pattern ID (e.g. CROSS-01)
  const patternId = task.rules[0];
  const pattern = ruleset.crossCutting.find((p) => p.id === patternId);

  if (!pattern) {
    throw new Error(`Cross-cutting pattern ${patternId} not found in ruleset`);
  }

  // Remaining rule IDs are the related rules
  const relatedRuleIds = task.rules.slice(1);
  const relatedRules = ruleset.rules.filter((r) => relatedRuleIds.includes(r.id));

  return {
    systemPrompt: crossCuttingSystemPrompt(pattern, relatedRules, ruleset.meta.framework),
    userPrompt: auditUserPrompt(files, task),
  };
}

/**
 * Generate prompts for any audit task based on its type.
 */
export function generatePrompt(
  task: AuditTask,
  files: FileContent[],
  ruleset: Ruleset,
): AuditPrompt {
  switch (task.type) {
    case "component-scan":
      return generateComponentScanPrompt(task, files, ruleset);
    case "cross-cutting":
      return generateCrossCuttingPrompt(task, files, ruleset);
    case "synthesis":
      throw new Error("Synthesis tasks do not use file-based prompts");
  }
}

// ── Response parsing ──

/**
 * Validate and normalize a severity string from LLM output.
 */
function normalizeSeverity(raw: string): AuditSeverity {
  const lower = raw.toLowerCase().trim();
  const valid: AuditSeverity[] = ["critical", "high", "medium", "low", "informational"];
  if (valid.includes(lower as AuditSeverity)) return lower as AuditSeverity;
  // Common LLM variations
  if (lower === "info") return "informational";
  if (lower === "warning" || lower === "moderate") return "medium";
  return "medium";
}

/**
 * Parse an LLM response into an AuditTaskResult.
 *
 * Accepts either:
 * - Pre-parsed structured output (from --json-schema constrained decoding) — no parsing needed
 * - Raw text (fallback) — extracts JSON with regex, handles markdown fences and LLM quirks
 *
 * Both paths normalize severity, clamp confidence, and handle field variations.
 */
export function parseAuditResponse(
  raw: string,
  task: AuditTask,
  model: string,
  tokensUsed: number,
  durationMs: number,
  structured?: unknown,
): AuditTaskResult {
  const baseResult: Omit<AuditTaskResult, "findings"> = {
    taskId: task.id,
    type: task.type,
    component: task.component,
    rulesChecked: task.rules,
    durationMs,
    model,
    tokensUsed,
  };

  try {
    let parsed: any;

    if (structured && typeof structured === "object") {
      // Structured output from --json-schema: already parsed, schema-validated
      parsed = structured;
    } else {
      // Text fallback: extract JSON from free-form response
      const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "");
      const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("No JSON object found in response");
      }
      parsed = JSON.parse(jsonMatch[0]);
    }

    const rawFindings: any[] = Array.isArray(parsed.findings) ? parsed.findings : [];

    const findings: AuditFinding[] = rawFindings.map((f: any) => ({
      ruleId: String(f.ruleId || f.rule_id || "UNKNOWN"),
      severity: normalizeSeverity(String(f.severity || "medium")),
      title: String(f.title || "Untitled finding").slice(0, 80),
      description: String(f.description || ""),
      locations: normalizeLocations(f.locations || f.location, task.files),
      evidence: String(f.evidence || ""),
      remediation: String(f.remediation || f.suggestion || f.fix || ""),
      confidence: clamp(Number(f.confidence) || 0.5, 0, 1),
    }));

    return { ...baseResult, findings };
  } catch (error) {
    // Parsing failed — return sanitized error finding (raw response not included)
    console.warn(`Audit response parse error for task ${task.id}:`, error);
    return {
      ...baseResult,
      findings: [
        {
          ruleId: "PARSE-ERROR",
          severity: "informational",
          title: "Failed to parse audit agent response",
          description: "Response was not valid JSON. Rerun this task for results.",
          locations: [],
          evidence: "",
          remediation: "Rerun this audit task",
          confidence: 0,
        },
      ],
    };
  }
}

/**
 * Normalize locations from various LLM output formats.
 */
function normalizeLocations(raw: any, taskFiles: string[]): AuditFinding["locations"] {
  if (!raw) {
    // No location provided — use first task file as fallback
    return taskFiles.length > 0 ? [{ file: taskFiles[0], startLine: 1 }] : [];
  }

  // Single location object
  if (!Array.isArray(raw)) {
    raw = [raw];
  }

  return raw.map((loc: any) => ({
    file: String(loc.file || loc.path || taskFiles[0] || "unknown"),
    startLine: Number(loc.startLine || loc.start_line || loc.line || 1),
    ...(loc.endLine || loc.end_line ? { endLine: Number(loc.endLine || loc.end_line) } : {}),
  }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
