import { parseRuleset } from '../planner/ruleset-parser';

const MINIMAL_RULESET = `---
framework: OWASP Top 10
version: "2021"
ruleset_version: "0.1.0"
scope: Web applications and APIs
languages: [typescript, javascript, python]
---

# OWASP Top 10 (2021) Ruleset

## A01:2021 — Broken Access Control

### BAC-01: Missing Authorization Checks on Endpoints

**Severity:** Critical
**Applies to:** API routes, HTTP handlers

**Compliant:** Every endpoint verifies permissions.

**Violation:** Endpoints that accept user IDs without checking ownership.

**What to look for:**
- Route handlers that read req.params.id without checking ownership
- Middleware that checks authentication but not authorization

**Guidance:** Authentication is not authorization. Both must be checked.

### BAC-02: Insecure Direct Object References (IDOR)

**Severity:** Critical
**Applies to:** API routes, database queries

**Compliant:** Resource identifiers are validated against the user's permissions.

**Violation:** Sequential IDs exposed without ownership checks.

**What to look for:**
- Routes like /api/users/:id/data where :id is used directly
- Database queries like findById(req.params.id) without WHERE userId

**Guidance:** UUIDs reduce guessability but do not replace authorization.

## A03:2021 — Injection

### INJ-01: SQL Injection

**Severity:** Critical
**Applies to:** Database access layers, query builders

**Compliant:** All SQL queries use parameterized queries.

**Violation:** String concatenation used to build SQL with user input.

**What to look for:**
- Template literal SQL
- ORM escape hatches like prisma.$queryRawUnsafe()

**Guidance:** ORMs generally prevent injection through their query builders.

## Cross-Cutting Concerns

### CROSS-01: PII Data Flow Tracing

**Scope:** Full codebase
**Relates to:** CRYPTO-01, LOG-02, AUTH-03

**Objective:** Trace PII from input through processing and storage to output.

**What to verify:**
- PII is encrypted at rest
- PII is not logged
- PII access is authorized
`;

describe('parseRuleset', () => {
  it('parses YAML frontmatter', () => {
    const ruleset = parseRuleset(MINIMAL_RULESET);

    expect(ruleset.meta.framework).toBe('OWASP Top 10');
    expect(ruleset.meta.version).toBe('2021');
    expect(ruleset.meta.rulesetVersion).toBe('0.1.0');
    expect(ruleset.meta.scope).toBe('Web applications and APIs');
    expect(ruleset.meta.languages).toEqual(['typescript', 'javascript', 'python']);
  });

  it('parses rules from categories', () => {
    const ruleset = parseRuleset(MINIMAL_RULESET);

    expect(ruleset.rules).toHaveLength(3);

    const bac01 = ruleset.rules.find(r => r.id === 'BAC-01');
    expect(bac01).toBeDefined();
    expect(bac01!.title).toBe('Missing Authorization Checks on Endpoints');
    expect(bac01!.category).toBe('A01:2021 — Broken Access Control');
    expect(bac01!.severity).toBe('Critical');
    expect(bac01!.appliesTo).toEqual(['API routes', 'HTTP handlers']);
    expect(bac01!.whatToLookFor).toHaveLength(2);
    expect(bac01!.guidance).toContain('Authentication is not authorization');
  });

  it('parses rules from multiple categories', () => {
    const ruleset = parseRuleset(MINIMAL_RULESET);

    const inj01 = ruleset.rules.find(r => r.id === 'INJ-01');
    expect(inj01).toBeDefined();
    expect(inj01!.category).toBe('A03:2021 — Injection');
    expect(inj01!.severity).toBe('Critical');
    expect(inj01!.appliesTo).toContain('Database access layers');
  });

  it('parses cross-cutting patterns', () => {
    const ruleset = parseRuleset(MINIMAL_RULESET);

    expect(ruleset.crossCutting).toHaveLength(1);

    const cross01 = ruleset.crossCutting[0];
    expect(cross01.id).toBe('CROSS-01');
    expect(cross01.title).toBe('PII Data Flow Tracing');
    expect(cross01.scope).toBe('Full codebase');
    expect(cross01.relatesTo).toEqual(['CRYPTO-01', 'LOG-02', 'AUTH-03']);
    expect(cross01.checks).toHaveLength(3);
    expect(cross01.checks[0]).toBe('PII is encrypted at rest');
  });

  it('throws on missing frontmatter', () => {
    expect(() => parseRuleset('# No frontmatter')).toThrow('YAML frontmatter');
  });
});
