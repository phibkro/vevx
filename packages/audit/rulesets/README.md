# Ruleset Authoring Guide

Rulesets are markdown documents that encode compliance requirements for automated code auditing. The LLM interprets the rules and applies them to source code — the markdown is both human-readable documentation and machine-readable instruction.

## Format

A ruleset has three parts: YAML frontmatter, rule definitions grouped by category, and optional cross-cutting patterns.

### Frontmatter

```yaml
---
framework: My Security Standard
version: "1.0"
ruleset_version: "0.1.0"
scope: Backend services
languages: [typescript, python, go]
---
```

| Field             | Required | Description                                     |
| ----------------- | -------- | ----------------------------------------------- |
| `framework`       | Yes      | Name of the compliance framework                |
| `version`         | Yes      | Version of the standard being encoded           |
| `ruleset_version` | No       | Version of this ruleset file (default: `0.1.0`) |
| `scope`           | No       | What kinds of codebases this applies to         |
| `languages`       | No       | Target programming languages (informational)    |

### Rules

Rules live under `##` category headings. Each rule is a `###` heading with structured fields.

```markdown
## Category Name

Description of the category (optional, ignored by parser).

### RULE-ID: Rule Title

**Severity:** Critical
**Applies to:** API routes, database queries

**Compliant:** Description of what correct code looks like.

**Violation:** Description of what incorrect code looks like.

**What to look for:**

- Specific pattern or code smell to check
- Another pattern to check
- A third thing to look for

**Guidance:** Additional context for interpretation — common false positives, edge cases, nuances.
```

**Field reference:**

| Field              | Required | Description                                               |
| ------------------ | -------- | --------------------------------------------------------- |
| `Severity`         | Yes      | `Critical`, `High`, `Medium`, `Low`, or `Informational`   |
| `Applies to`       | Yes      | Comma-separated list of component types this rule targets |
| `Compliant`        | Yes      | What correct behavior looks like                          |
| `Violation`        | Yes      | What incorrect behavior looks like                        |
| `What to look for` | No       | Bulleted list of specific patterns to check               |
| `Guidance`         | No       | Interpretation hints, false positive notes, edge cases    |

**Rule ID conventions:**

- Short, uppercase, hyphenated: `BAC-01`, `CRYPTO-03`, `ORG-SEC-01`
- Prefix groups related rules: `BAC-*` for access control, `INJ-*` for injection
- These IDs are used in suppressions (`// audit-suppress BAC-01`) and drift tracking

**Severity levels** (used for prioritization and reporting):

- **Critical** — actively exploitable, immediate risk
- **High** — significant risk, should fix before release
- **Medium** — moderate risk, fix when practical
- **Low** — minor risk, best practice improvement
- **Informational** — no direct risk, awareness only

### Applies-to Tags and Manifest Matching

The `Applies to` field controls which components get checked against each rule. Two matching strategies:

**With manifest (`varp.yaml`):** If components have `tags`, rules are matched by tag overlap. A rule with `Applies to: API routes, database queries` matches components tagged `api` or `database`. The match is substring-based — the tag `api` matches `API routes`.

**Without manifest:** Falls back to filename heuristics. The planner matches `Applies to` values against common filename patterns (e.g., `API routes` matches files containing `route`, `controller`, `handler`).

### Cross-Cutting Patterns

Cross-cutting patterns analyze behavior that spans multiple components. They run in Wave 2 (after component scans) and see findings from Wave 1.

Define them under a `## Cross-Cutting` category heading (the heading must contain "cross-cutting", case-insensitive):

```markdown
## Cross-Cutting Concerns

### CROSS-01: Pattern Title

**Scope:** Full codebase
**Relates to:** RULE-01, RULE-02

**Objective:** What this cross-cutting analysis should determine.

**What to verify:**

- Check that spans multiple components
- Another cross-component check
```

| Field            | Required | Description                                                      |
| ---------------- | -------- | ---------------------------------------------------------------- |
| `Scope`          | No       | What parts of the codebase to analyze (default: `Full codebase`) |
| `Relates to`     | No       | Comma-separated rule IDs this pattern relates to                 |
| `Objective`      | Yes      | What the analysis should determine                               |
| `What to verify` | Yes      | Bulleted list of cross-component checks                          |

Cross-cutting pattern IDs must start with `CROSS-` followed by a number.

## Writing Effective Rules

**Be specific about patterns.** "Check for SQL injection" is too vague. "String concatenation or template literals used to build SQL queries with user input" tells the LLM exactly what to look for.

**Include both compliant and violation examples.** The contrast helps the LLM distinguish correct from incorrect code. One-sided rules produce more false positives.

**Use "What to look for" liberally.** Bulleted lists of concrete patterns are the most useful part of a rule. They're what the LLM actually scans for. 4-6 items is a good range.

**Write guidance for edge cases.** If a pattern has common false positives, say so. "ORMs generally handle parameterization, but check for raw query escape hatches" prevents noise.

**Scope with "Applies to".** Not every rule applies everywhere. Targeting rules to relevant components reduces false positives and token usage.

## Example: Minimal Custom Ruleset

```markdown
---
framework: Acme Security Policy
version: "1.0"
ruleset_version: "0.1.0"
scope: Internal services
languages: [typescript]
---

## Authentication

### AUTH-01: JWT Validation

**Severity:** Critical
**Applies to:** API routes, middleware

**Compliant:** All JWT tokens are validated with signature verification, expiration check, and issuer validation before granting access.

**Violation:** JWT tokens decoded without signature verification, or only the payload is read without checking `exp` and `iss` claims.

**What to look for:**

- Use of `jwt.decode()` instead of `jwt.verify()` for authentication decisions
- Missing `algorithms` option in verify calls (allows algorithm confusion attacks)
- No check on `exp` claim (accepts expired tokens)
- No check on `iss` claim (accepts tokens from any issuer)

**Guidance:** Libraries like jose and jsonwebtoken have different default behaviors. jose rejects expired tokens by default; jsonwebtoken does not unless `maxAge` or `clockTolerance` is set.

## Cross-Cutting Concerns

### CROSS-01: Token Propagation

**Scope:** All services
**Relates to:** AUTH-01

**Objective:** Verify that authentication tokens are propagated correctly between services and not logged, cached in plaintext, or passed via URL query parameters.

**What to verify:**

- Tokens are passed in Authorization headers, not URL parameters
- Tokens are not included in log output or error messages
- Token caching (if any) uses encrypted storage with TTL
```

## Using Custom Rulesets

```bash
# By path
varp audit ./src --ruleset ./my-rules.md

# By name (if placed in packages/audit/rulesets/)
varp audit ./src --ruleset my-rules
```
