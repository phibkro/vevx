import type { RulesetMeta, Rule, CrossCuttingPattern, Ruleset } from "./types";

/**
 * Parse YAML frontmatter from a markdown string.
 * Returns the parsed metadata and the remaining markdown body.
 */
function parseFrontmatter(content: string): { meta: RulesetMeta; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Ruleset must have YAML frontmatter (--- delimited)");
  }

  const yaml = match[1];
  const body = match[2];

  // Simple YAML parser for flat key-value pairs and arrays
  const meta: Record<string, any> = {};
  for (const line of yaml.split("\n")) {
    const kvMatch = line.match(/^(\w[\w_-]*)\s*:\s*(.+)$/);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;
    let value: any = rawValue.trim();

    // Handle quoted strings
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Handle inline arrays: [a, b, c]
    else if (value.startsWith("[") && value.endsWith("]")) {
      value = value
        .slice(1, -1)
        .split(",")
        .map((s: string) => s.trim());
    }

    meta[key] = value;
  }

  return {
    meta: {
      framework: meta.framework || "unknown",
      version: meta.version || "0",
      rulesetVersion: meta.ruleset_version || meta.rulesetVersion || "0.1.0",
      scope: meta.scope || "",
      languages: Array.isArray(meta.languages) ? meta.languages : [],
    },
    body,
  };
}

/**
 * Parse a single rule block (### heading + fields).
 *
 * Expected format:
 * ### RULE-ID: Title
 * **Severity:** Critical
 * **Applies to:** API routes, HTTP handlers
 * **Compliant:** ...
 * **Violation:** ...
 * **What to look for:**
 * - item 1
 * - item 2
 * **Guidance:** ...
 */
function parseRule(block: string, category: string): Rule | null {
  // Match heading: ### RULE-ID: Title or ### ID: Title — Extra
  const headingMatch = block.match(/^###\s+([\w-]+):\s*(.+)$/m);
  if (!headingMatch) return null;

  const id = headingMatch[1];
  const title = headingMatch[2].trim();

  const severity = extractField(block, "Severity") || "Medium";
  const appliesTo = extractField(block, "Applies to") || "";
  const compliant = extractField(block, "Compliant") || "";
  const violation = extractField(block, "Violation") || "";
  const guidance = extractField(block, "Guidance") || "";
  const whatToLookFor = extractList(block, "What to look for");

  return {
    id,
    title,
    category,
    severity,
    appliesTo: appliesTo
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    compliant,
    violation,
    whatToLookFor,
    guidance,
  };
}

/**
 * Extract a **Field:** value from a block of text.
 * Captures everything after the field label until the next **Field:** or end of block.
 */
function extractField(block: string, fieldName: string): string | null {
  // Match **Field:** or **Field:**\n with content up to next **Field:** or ### or end
  const regex = new RegExp(
    `\\*\\*${fieldName}:\\*\\*\\s*([\\s\\S]*?)(?=\\n\\*\\*\\w|\\n###|$)`,
    "i",
  );
  const match = block.match(regex);
  if (!match) return null;

  return match[1].trim();
}

/**
 * Extract a bulleted list under a **Field:** heading.
 */
function extractList(block: string, fieldName: string): string[] {
  const content = extractField(block, fieldName);
  if (!content) return [];

  return content
    .split("\n")
    .filter((line) => line.match(/^\s*-\s+/))
    .map((line) => line.replace(/^\s*-\s+/, "").trim());
}

/**
 * Parse a cross-cutting pattern block.
 *
 * Expected format:
 * ### CROSS-ID: Title
 * **Scope:** Full codebase
 * **Relates to:** RULE-01, RULE-02
 * **Objective:** ...
 * **What to verify:**
 * - check 1
 * - check 2
 */
function parseCrossCuttingPattern(block: string): CrossCuttingPattern | null {
  const headingMatch = block.match(/^###\s+(CROSS-\d+):\s*(.+)$/m);
  if (!headingMatch) return null;

  const id = headingMatch[1];
  const title = headingMatch[2].trim();

  const scope = extractField(block, "Scope") || "Full codebase";
  const relatesTo = (extractField(block, "Relates to") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const objective = extractField(block, "Objective") || "";
  const checks = extractList(block, "What to verify");

  return { id, title, scope, relatesTo, objective, checks };
}

/**
 * Parse a complete ruleset markdown file into structured data.
 */
export function parseRuleset(content: string): Ruleset {
  const { meta, body } = parseFrontmatter(content);

  // Split body into category sections (## headings)
  const categorySections = body.split(/\n(?=## )/);

  const rules: Rule[] = [];
  const crossCutting: CrossCuttingPattern[] = [];

  for (const section of categorySections) {
    const categoryMatch = section.match(/^## (.+)$/m);
    if (!categoryMatch) continue;

    const categoryTitle = categoryMatch[1].trim();

    // Check if this is the cross-cutting section
    if (categoryTitle.toLowerCase().includes("cross-cutting")) {
      // Split into individual pattern blocks (### headings)
      const patternBlocks = section.split(/\n(?=### )/);
      for (const block of patternBlocks) {
        const pattern = parseCrossCuttingPattern(block);
        if (pattern) crossCutting.push(pattern);
      }
      continue;
    }

    // Regular category — split into rule blocks (### headings)
    const ruleBlocks = section.split(/\n(?=### )/);
    for (const block of ruleBlocks) {
      const rule = parseRule(block, categoryTitle);
      if (rule) rules.push(rule);
    }
  }

  return { meta, rules, crossCutting };
}
