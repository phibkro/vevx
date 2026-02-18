import { readFileSync } from "fs";
import { join } from "path";

import { parseRuleset } from "../planner/ruleset-parser";

describe("OWASP Top 10 ruleset (real file)", () => {
  const rulesetPath = join(__dirname, "../../rulesets/owasp-top-10.md");
  const content = readFileSync(rulesetPath, "utf-8");
  const ruleset = parseRuleset(content);

  it("parses metadata", () => {
    expect(ruleset.meta.framework).toBe("OWASP Top 10");
    expect(ruleset.meta.version).toBe("2021");
    expect(ruleset.meta.languages).toContain("typescript");
    expect(ruleset.meta.languages).toContain("python");
  });

  it("parses all rules", () => {
    // OWASP ruleset has 28+ rules across 10 categories
    expect(ruleset.rules.length).toBeGreaterThanOrEqual(28);
  });

  it("parses all 3 cross-cutting patterns", () => {
    expect(ruleset.crossCutting.length).toBe(3);
  });

  it("every rule has required fields", () => {
    for (const rule of ruleset.rules) {
      expect(rule.id).toBeTruthy();
      expect(rule.title).toBeTruthy();
      expect(rule.category).toBeTruthy();
      expect(rule.severity).toBeTruthy();
      expect(rule.appliesTo.length).toBeGreaterThan(0);
    }
  });

  it("cross-cutting patterns reference other rules", () => {
    for (const pattern of ruleset.crossCutting) {
      expect(pattern.id).toMatch(/^CROSS-\d+$/);
      expect(pattern.relatesTo.length).toBeGreaterThan(0);
      expect(pattern.checks.length).toBeGreaterThan(0);
    }
  });

  it("rule IDs are unique", () => {
    const ids = ruleset.rules.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all OWASP categories", () => {
    const categories = new Set(ruleset.rules.map((r) => r.category));
    expect(categories.size).toBe(10);
  });
});
