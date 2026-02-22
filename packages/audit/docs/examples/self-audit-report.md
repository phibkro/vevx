# Compliance Audit Report

|              |                          |
| ------------ | ------------------------ |
| **Ruleset**  | OWASP Top 10 v0.1.0      |
| **Files**    | 41 across 1 components   |
| **Date**     | 2026-02-18T06:29:52.953Z |
| **Duration** | 138.6s                   |

## Summary

| Severity      | Count  |
| ------------- | ------ |
| Critical      | 3      |
| High          | 5      |
| Low           | 1      |
| Informational | 6      |
| **Total**     | **15** |

## Findings

### CRITICAL: Claude CLI stderr silently discarded — error path may not sanitize credentials (corroborated x2)

- **Rule:** AUTH-03
- **Confidence:** 82%
- **Location:** `packages/audit/src/client.ts:22-30`
- **Location:** `packages/audit/src/client.ts:62-62`

In client.ts, the `spawnClaude` function collects stderr output into `errChunks` (line 62) but never uses it — on CLI exit with code !== 0, only a generic message is thrown (line 68), not the stderr content. However, the pattern of collecting sensitive subprocess output into a buffer is a concern: if a future change inadvertently logs `errChunks`, it could expose credentials passed to the CLI via environment or argument context. More directly: the `args` array at line 22-29 in `callClaude` includes `systemPrompt` and `userPrompt` as CLI arguments. On most operating systems, process arguments are visible in process listings. While not a logging issue per se, if any error handler were to log `args`, credentials embedded in prompts could be exposed.

**Evidence:** const args = ['-p', '--system-prompt', systemPrompt, '--model', options.model, '--tools', '', '--output-format', 'text', '--no-session-persistence', userPrompt]; ... proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk));

**Remediation:** Ensure `errChunks` is never logged. Additionally, consider whether system/user prompts passed as CLI arguments could contain sensitive data; if so, prefer stdin-based input over argument-based input to avoid process-listing exposure. For error reporting, sanitize the error output before any logging.

---

### CRITICAL: Rejected agent promise logged with raw reason

- **Rule:** AUTH-03
- **Confidence:** 78%
- **Location:** `packages/audit/src/orchestrator.ts:123-123`

In orchestrator.ts at line 123, a rejected promise's `.reason` is logged verbatim: `console.error('Agent ${agent.name} promise rejected:', result.reason)`. A promise rejection reason from an API call can include HTTP response bodies, headers, or error details that embed credentials such as API keys, Authorization tokens, or session identifiers.

**Evidence:** console.error(`Agent ${agent.name} promise rejected:`, result.reason);

**Remediation:** Extract only the message from the rejection reason before logging: `console.error('Agent promise rejected:', agent.name, result.reason instanceof Error ? result.reason.message : String(result.reason))`. Avoid logging the full rejection object which may carry embedded credentials from upstream API errors.

---

### CRITICAL: Agent errors logged with full error object

- **Rule:** AUTH-03
- **Confidence:** 75%
- **Location:** `packages/audit/src/orchestrator.ts:55-55`

In orchestrator.ts, the catch block at line 55 logs the full error object with `console.error('Agent ${agent.name} failed:', error)`. If the error originates from an authentication failure or API call that embeds credentials (e.g., an Authorization header, API key, or token in an error message or stack trace), this would expose those credentials in logs.

**Evidence:** console.error(`Agent ${agent.name} failed:`, error);

**Remediation:** Log only sanitized error information: log the error message string (not the full Error object with potential stack traces or cause chains that may embed credentials) and explicitly exclude any fields that could carry tokens or keys. E.g., `console.error('Agent failed:', agent.name, error instanceof Error ? error.message : String(error))`.

---

### HIGH: Error object logged directly, may expose sensitive context (corroborated x2)

- **Rule:** LOG-02
- **Confidence:** 85%
- **Location:** `packages/audit/src/orchestrator.ts:55`

In orchestrator.ts line 55, the full error object is passed to console.error along with the agent name. Error objects can carry stack traces, request context, API responses, or other sensitive runtime data embedded by upstream code. Since this is an audit engine that processes arbitrary user code and calls external APIs, error objects may contain request bodies, API keys from environment, or file content fragments from the code being audited.

**Evidence:** console.error(`Agent ${agent.name} failed:`, error);

**Remediation:** Log only a sanitized message: `console.error('Agent failed', { agent: agent.name, message: error instanceof Error ? error.message : String(error) })`. Do not spread the raw error object, which may carry sensitive context in its properties.

---

### HIGH: Raw error logged in prompt-generator parse failure, may expose LLM response cont (corroborated x2)

- **Rule:** LOG-02
- **Confidence:** 82%
- **Location:** `packages/audit/src/planner/prompt-generator.ts:318`

In planner/prompt-generator.ts line 318, the raw parse error is logged with console.warn, and the task ID is included. More critically, the raw LLM response (variable `raw`) is NOT logged here — the code is actually well-sanitized in this path. However, the error object itself from JSON.parse may carry a substring of the input in some runtimes. Low risk but worth noting the pattern is consistent with the others.

**Evidence:** console.warn(`Audit response parse error for task ${task.id}:`, error);

**Remediation:** Log only the error message string: `console.warn('Audit response parse error', { taskId: task.id, error: error instanceof Error ? error.message : String(error) })`. This avoids any runtime-specific error object properties that may carry input fragments.

---

### HIGH: PII in analyzed source files flows into user prompts sent to external CLI with n

- **Rule:** CROSS-01
- **Confidence:** 82%
- **Location:** `packages/audit/src/discovery.ts:140-148`
- **Location:** `packages/audit/src/discovery-node.ts:145-153`
- **Location:** `packages/audit/src/orchestrator.ts:32-44`
- **Location:** `packages/audit/src/planner/executor.ts:56-59`
- **Location:** `packages/audit/src/client.ts:15-31`

The audit engine reads arbitrary source code files (discovery.ts / discovery-node.ts) and passes their full content verbatim into prompts sent to the Claude CLI (client.ts via callClaude). If the analyzed codebase contains PII — hardcoded test data, database seeds, config files with real email/SSN/phone values — that PII is transmitted to an external process (the claude CLI) without any scrubbing or notice to the caller. The FileContent objects carry the raw file content through the entire pipeline: discoverFiles → createChunks → runAgent / executeTask → callClaude.

**Evidence:** discoverFiles() reads file.content = readFileSync(fullPath, 'utf-8'); this content flows into userPromptTemplate(files) / auditUserPrompt(files, task) which embeds it verbatim in the prompt passed to callClaude(systemPrompt, userPrompt, options) which spawns the claude CLI with userPrompt as a CLI argument, making the full file content an argument to an external process.

**Remediation:** Add a disclosure notice to the CLI/API surface that file content (potentially including PII in test fixtures or config files) is transmitted to the Claude CLI. Consider adding a --exclude-patterns option to skip files matching patterns like _.env, seed._, fixture.\*, or files containing known PII patterns. At minimum, document this data flow in the tool's privacy documentation.

---

### HIGH: Raw error object logged in promise rejection handler

- **Rule:** LOG-02
- **Confidence:** 75%
- **Location:** `packages/audit/src/orchestrator.ts:123`

In orchestrator.ts line 123, the full result.reason (the rejection value) is passed to console.error. A rejected promise in the audit pipeline may carry API error responses from Claude, which can include prompt content, partial completions containing the user's source code, or other sensitive runtime state. Logging result.reason directly may expose this.

**Evidence:** console.error(`Agent ${agent.name} promise rejected:`, result.reason);

**Remediation:** Extract only a safe message: `console.error('Agent promise rejected', { agent: agent.name, reason: result.reason instanceof Error ? result.reason.message : String(result.reason) })`. Avoid logging the full rejection value.

---

### HIGH: PII from analyzed files included verbatim in audit findings (evidence field)

- **Rule:** CROSS-01
- **Confidence:** 75%
- **Location:** `packages/audit/src/planner/findings.ts:57-57`
- **Location:** `packages/audit/src/planner/compliance-reporter.ts:154-156`
- **Location:** `packages/audit/src/planner/compliance-reporter.ts:242-244`

The compliance report's AuditFinding.evidence field contains 'the specific code pattern or behavior observed' — meaning verbatim code snippets extracted from the analyzed files. These findings are stored in ComplianceReport, printed to terminal via printComplianceReport, serialized via generateComplianceMarkdown and generateComplianceJson. If a finding references a line that contains a hardcoded credential, email, or SSN from the analyzed code, that PII is written into audit output files and printed to stdout without redaction.

**Evidence:** AuditFinding.evidence: string — populated from LLM response which echoes back code snippets; formatFindingMarkdown outputs `**Evidence:** ${f.evidence}`; generateComplianceJson returns JSON.stringify(report) including all evidence fields verbatim.

**Remediation:** Apply a regex-based redaction pass over the evidence field before including it in reports, masking patterns matching email addresses, phone numbers, SSN formats, credit card numbers, and high-entropy strings (potential API keys). Alternatively, truncate evidence to the first 200 characters and warn users that evidence fields may contain sensitive content from analyzed files.

---

### LOW: Consistent, safe secret access pattern via Claude Code CLI session

- **Rule:** CROSS-03
- **Confidence:** 95%
- **Location:** `packages/audit/src/client.ts:33-46`

This is a positive finding confirming compliance. The client.ts deliberately avoids ANTHROPIC_API_KEY by delegating authentication to the Claude Code CLI's own session token. The filteredEnv() function explicitly allowlists environment variables passed to the subprocess, preventing accidental leakage of secrets from the parent process environment into the child process. This is a well-designed secrets management pattern.

**Evidence:** const ALLOWED_ENV_KEYS = ['HOME', 'USER', 'PATH', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'NODE_ENV', 'NO_COLOR']; — explicit allowlist excludes all secret-bearing env vars from subprocess environment.

**Remediation:** No action required. Pattern is compliant. Document this design decision so future contributors understand why ANTHROPIC_API_KEY is intentionally absent from the allowlist.

---

### INFORMATIONAL: No hardcoded secrets found in source files

- **Rule:** CRYPTO-04
- **Confidence:** 95%

Full scan of all submitted source files found no hardcoded API keys, passwords, tokens, private keys, connection strings with embedded credentials, or JWT secrets. All files follow the correct pattern of either using no credentials (CLI session auth) or delegating to environment variables.

**Evidence:** Searched all TypeScript source files for patterns: sk*live*, sk*test*, AKIA, ghp\_, -----BEGIN, Bearer , postgres://_:_@, jwt.sign(\*, '). No matches found. The only credential-adjacent string is 'ANTHROPIC_API_KEY' appearing as a string literal in a test fixture (client.test.ts line 15), which is a field name in a ValidationError test, not an actual key value.

**Remediation:** No action required.

---

### INFORMATIONAL: No default credentials or seed data found

- **Rule:** MISCONFIG-03
- **Confidence:** 90%

No seed scripts, Docker Compose files, initialization scripts, or configuration files with default credentials were present in the submitted file set. No patterns matching admin@example.com, password: changeme, POSTGRES_PASSWORD=postgres, or similar default credential patterns were found.

**Evidence:** No Docker, seed, fixture, or deployment configuration files were present in the submitted file set. Test fixtures use placeholder values that are clearly scoped to testing (e.g., model names, finding structures) with no password or credential fields.

**Remediation:** No action required for submitted files. If Docker Compose or deployment configuration files exist in the repository, submit them for review.

---

### INFORMATIONAL: Stale test comment references ANTHROPIC_API_KEY validation

- **Rule:** CROSS-03
- **Confidence:** 85%
- **Location:** `packages/audit/src/__tests__/client.test.ts:13-20`

The client test file contains a comment and test case named 'validates ANTHROPIC_API_KEY is required' and constructs a ValidationError for 'ANTHROPIC_API_KEY'. This is vestigial from a prior architecture where the Anthropic SDK was used directly (per the commit history: 'refactor(audit): replace Anthropic SDK with Claude Code CLI'). The test no longer reflects the actual client implementation, which does not use ANTHROPIC_API_KEY at all. While not a hardcoded secret, this creates misleading documentation suggesting the system requires an API key when it does not, which could cause confusion about the secrets model.

**Evidence:** describe('Missing API key', () => { it('validates ANTHROPIC_API_KEY is required', () => { const error = new ValidationError('ANTHROPIC_API_KEY', 'Environment variable is not set') — test validates a pattern that no longer exists in client.ts after the SDK-to-CLI refactor.

**Remediation:** Update or remove the stale test. The current client.ts has no API key validation logic (auth is handled by the CLI session). The test file's comment on line 6-9 already acknowledges this is a placeholder, but the test itself should be updated to reflect the actual architecture.

---

### INFORMATIONAL: .gitignore not provided for verification

- **Rule:** CROSS-03
- **Confidence:** 50%
- **Location:** `packages/audit/src/discovery.ts:33-59`
- **Location:** `packages/audit/src/discovery-node.ts:33-60`

The analysis cannot confirm whether .env files and credential files are included in .gitignore because no .gitignore file was provided in the file set. The codebase's discovery module (discovery.ts, discovery-node.ts) reads .gitignore at runtime for file filtering, which is correct behavior, but the actual .gitignore content was not submitted for review. This is a gap in the audit scope rather than a confirmed violation.

**Evidence:** parseGitignore() reads .gitignore at runtime but the .gitignore file itself was not included in the audit scope. Cannot verify that .env, credential files, and CI/CD secrets are excluded from version control.

**Remediation:** Include .gitignore in the audit scope and verify it contains entries for: .env, .env._, _.pem, \*.key, id_rsa, credentials.json, and similar credential files.

---

### INFORMATIONAL: No CI/CD pipeline configuration files provided for review

- **Rule:** CROSS-03
- **Confidence:** 50%

No CI/CD configuration files (.github/workflows/\*.yml, .gitlab-ci.yml, Jenkinsfile, etc.) were included in the audit scope. Cannot verify whether pipeline configurations contain hardcoded secrets, API keys, or tokens committed to the repository.

**Evidence:** CI/CD configuration files were not present in the submitted file set. The planner's TAG_PATTERNS includes patterns for CI/CD files (/\.github/i, /ci/i, /workflow/i) indicating the codebase is aware of their existence, but they were not submitted for review.

**Remediation:** Submit CI/CD pipeline configuration files for review. Verify that secrets are sourced from the CI/CD platform's secret store (e.g., GitHub Actions secrets, GitLab CI variables) and not hardcoded in workflow YAML files.

---

### INFORMATIONAL: Failed to parse audit agent response

- **Rule:** PARSE-ERROR
- **Confidence:** 0%

Response was not valid JSON. Rerun this task for results.

**Remediation:** Rerun this audit task

---

## Coverage

- **Components:** 100%
- **Rules:** 34%

## Metadata

- **Tasks executed:** 11 (0 failed)
- **Tokens used:** 506,916
- **Models:** claude-sonnet-4-5-20250929
