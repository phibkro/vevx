---
framework: OWASP Top 10
version: "2021"
ruleset_version: "0.1.0"
scope: Web applications and APIs
languages: [typescript, javascript, python, go, java, rust, c, cpp]
---

# OWASP Top 10 (2021) Ruleset

This ruleset encodes the [OWASP Top 10 (2021)](https://owasp.org/Top10/) as structured rules for automated code auditing. Each rule describes what compliant and non-compliant code looks like, with enough specificity for an LLM agent to identify violations in real codebases.

Rules are grouped by OWASP category. Within each category, rules are ordered by severity.

---

## A01:2021 — Broken Access Control

Access control enforces that users cannot act outside their intended permissions. Failures lead to unauthorized disclosure, modification, or destruction of data.

### BAC-01: Missing Authorization Checks on Endpoints

**Severity:** Critical
**Applies to:** API routes, HTTP handlers, GraphQL resolvers, RPC handlers

**Compliant:** Every endpoint that accesses or mutates user-scoped data verifies that the authenticated user has permission to perform the action on the specific resource. Authorization is checked server-side, not just client-side.

**Violation:** Endpoints that accept a user ID, resource ID, or other identifier from the request and use it to fetch/modify data without verifying the authenticated user owns or has access to that resource.

**What to look for:**
- Route handlers that read `req.params.id` or `req.body.userId` and pass directly to a database query without checking ownership
- Middleware that checks authentication (is the user logged in?) but not authorization (can this user access this resource?)
- Admin-only routes that check for a role but don't validate it server-side
- GraphQL resolvers that return data based solely on the queried ID

**Guidance:** Authentication (who are you?) is not authorization (what can you do?). Both must be checked. Look for the pattern: fetch resource → check `resource.ownerId === currentUser.id` → proceed. Its absence is the violation.

### BAC-02: Insecure Direct Object References (IDOR)

**Severity:** Critical
**Applies to:** API routes, database queries, file access handlers

**Compliant:** Resource identifiers in URLs or request bodies are validated against the authenticated user's permissions before use. Alternatively, resources are always scoped to the authenticated user's context (e.g., `WHERE userId = currentUser.id`).

**Violation:** Sequential or predictable resource IDs (numeric auto-increment) exposed in APIs without ownership checks, allowing enumeration.

**What to look for:**
- Routes like `/api/users/:id/data` where `:id` is used directly in queries
- Database queries like `findById(req.params.id)` without a `WHERE userId = ...` clause
- File paths constructed from user input: `path.join(uploads, req.params.filename)`
- Absence of ownership/permission checks between receiving the ID and using it

**Guidance:** UUIDs reduce guessability but do not replace authorization checks. The fix is always server-side validation, not obscurity.

### BAC-03: Missing Function-Level Access Control

**Severity:** High
**Applies to:** Admin routes, privileged operations, role-gated features

**Compliant:** Privileged operations (user management, configuration changes, data export) check the user's role/permissions server-side before executing.

**Violation:** Admin functionality protected only by hiding UI elements, relying on client-side route guards, or using a shared endpoint without role validation.

**What to look for:**
- Admin API routes without middleware that checks `user.role === 'admin'`
- Privilege checks only in frontend code (React route guards, Vue navigation guards) without corresponding backend checks
- Endpoints that perform different actions based on a `role` field in the request body (user-controllable)

**Guidance:** Every privileged operation must check permissions on the server. Client-side guards are UX, not security.

### BAC-04: CORS Misconfiguration

**Severity:** High
**Applies to:** HTTP server configuration, middleware setup

**Compliant:** CORS `Access-Control-Allow-Origin` is set to a specific list of trusted origins. Credentials are only allowed for trusted origins. Wildcard (`*`) is not used with credentials.

**Violation:**
- `Access-Control-Allow-Origin: *` on endpoints that handle authenticated requests
- Reflecting the request's `Origin` header back as `Access-Control-Allow-Origin` without validation
- `Access-Control-Allow-Credentials: true` with a wildcard or reflected origin

**What to look for:**
- CORS middleware configuration with `origin: '*'` or `origin: true`
- Dynamic origin that reads from request and reflects without allowlist check
- Credentials enabled without origin restriction

**Guidance:** Wildcard CORS is acceptable for truly public, unauthenticated APIs (public data feeds). It is a vulnerability on any endpoint that uses cookies, tokens, or other credentials.

---

## A02:2021 — Cryptographic Failures

Previously "Sensitive Data Exposure." Focuses on failures related to cryptography that lead to exposure of sensitive data.

### CRYPTO-01: Sensitive Data in Plaintext Storage

**Severity:** Critical
**Applies to:** Database schemas, configuration files, data models, cache layers

**Compliant:** Passwords are hashed with bcrypt, scrypt, or Argon2. API keys, tokens, and secrets are hashed or encrypted at rest. PII is encrypted when stored.

**Violation:** Passwords stored as plaintext or with weak hashing (MD5, SHA-1, SHA-256 without salt). API keys stored as plaintext in the database. Sensitive fields without encryption.

**What to look for:**
- Database columns named `password`, `secret`, `apiKey`, `token` stored as plain `VARCHAR`/`TEXT` without corresponding hashing logic in the write path
- Use of `md5()`, `sha1()`, or unsalted `sha256()` for password hashing
- Comparison like `user.password === inputPassword` (plaintext comparison)
- API keys stored and compared as plaintext strings

**Guidance:** Check both the storage schema AND the code path that writes to it. A `password` column might be hashed by application logic even if the schema type is `TEXT`. Look for the hashing call in the create/update path.

### CRYPTO-02: Sensitive Data in Transit Without TLS

**Severity:** High
**Applies to:** HTTP clients, API calls, database connections, message queues

**Compliant:** All external API calls use HTTPS. Database connections use TLS/SSL. Internal service-to-service communication uses TLS in production.

**Violation:** HTTP URLs (not HTTPS) in API client configurations, database connection strings without SSL parameters, or explicit TLS disabling.

**What to look for:**
- Hardcoded `http://` URLs for API endpoints (not localhost/development)
- Database connection strings without `?ssl=true`, `?sslmode=require`, or equivalent
- `rejectUnauthorized: false` or `NODE_TLS_REJECT_UNAUTHORIZED=0` in production code
- gRPC channels created without TLS credentials

**Guidance:** `http://localhost` in development is acceptable. The violation is non-TLS connections to production services. Check environment-specific configuration to distinguish.

### CRYPTO-03: Weak Cryptographic Algorithms

**Severity:** High
**Applies to:** Encryption logic, hashing, signature verification, token generation

**Compliant:** AES-256-GCM or ChaCha20-Poly1305 for symmetric encryption. RSA-2048+ or Ed25519 for asymmetric. SHA-256+ for integrity hashing. HMAC-SHA256+ for message authentication.

**Violation:** DES, 3DES, RC4, Blowfish for encryption. MD5 or SHA-1 for integrity or signatures. RSA with key size < 2048 bits. ECB mode for block ciphers.

**What to look for:**
- `createCipheriv('des', ...)`, `createCipheriv('aes-128-ecb', ...)`
- `createHash('md5')` or `createHash('sha1')` used for security purposes (not checksums)
- JWT signed with `HS256` using a short or hardcoded secret
- `Math.random()` or equivalent used for generating tokens, IDs, or cryptographic material

**Guidance:** MD5/SHA-1 for non-security checksums (file integrity, cache keys) is acceptable. The concern is using them where collision resistance or pre-image resistance matters (signatures, password hashing, token generation).

### CRYPTO-04: Hardcoded Secrets and Keys

**Severity:** Critical
**Applies to:** All source files, configuration files

**Compliant:** Secrets loaded from environment variables, secret managers, or encrypted configuration. No secrets in source code.

**Violation:** API keys, passwords, tokens, private keys, or connection strings with credentials hardcoded in source files.

**What to look for:**
- String literals that match patterns: `sk_live_`, `sk_test_`, `AKIA`, `ghp_`, `-----BEGIN`, `Bearer `, long base64 strings assigned to variables named `key`, `secret`, `token`, `password`
- Database URLs with embedded credentials: `postgres://user:password@host`
- JWT secrets as string literals: `jwt.sign(payload, 'my-secret')`
- `.env` files committed to version control (check `.gitignore`)

**Guidance:** Test/development placeholder values (`sk_test_xxx`, `password123` in test fixtures) are acceptable. The violation is production-plausible secrets in source. When in doubt, flag it — false positives are preferable to missed secrets.

---

## A03:2021 — Injection

Injection flaws occur when untrusted data is sent to an interpreter as part of a command or query.

### INJ-01: SQL Injection

**Severity:** Critical
**Applies to:** Database access layers, query builders, raw SQL execution

**Compliant:** All SQL queries use parameterized queries, prepared statements, or ORM methods that handle parameterization.

**Violation:** String concatenation, template literals, or string formatting used to build SQL queries with values derived from user input.

**What to look for:**
- `` `SELECT * FROM users WHERE id = ${userId}` `` (template literal SQL)
- `"SELECT * FROM users WHERE id = " + req.params.id` (concatenation)
- `query("SELECT * FROM users WHERE name = '" + name + "'")`
- ORM escape hatches: `sequelize.query()`, `knex.raw()`, `prisma.$queryRawUnsafe()`, `prisma.$executeRawUnsafe()` with interpolated values
- Python f-strings in SQL: `f"SELECT * FROM users WHERE id = {user_id}"`

**Guidance:** ORMs (Prisma, SQLAlchemy, ActiveRecord) generally prevent injection through their query builders. Focus on raw query methods and escape hatches. `prisma.$queryRaw` with tagged template literals IS safe (Prisma parameterizes them). `prisma.$queryRawUnsafe` is NOT.

### INJ-02: NoSQL Injection

**Severity:** Critical
**Applies to:** MongoDB queries, Elasticsearch queries, other NoSQL data access

**Compliant:** Query operators and values are constructed programmatically, not from raw user input. Input is validated/typed before use in queries.

**Violation:** User input passed directly as MongoDB query objects, allowing operator injection (`$gt`, `$ne`, `$regex`).

**What to look for:**
- `collection.find(req.body)` or `collection.find({ email: req.body.email })` where `req.body.email` could be `{ "$ne": "" }`
- `Model.find(req.query)` passing request query params directly as Mongoose filter
- Missing type validation: expecting a string but accepting an object

**Guidance:** The fix is input validation — ensure expected strings are actually strings, expected numbers are numbers. Schema validation libraries (Zod, Joi, class-validator) applied to request bodies prevent this class of attack.

### INJ-03: Command Injection

**Severity:** Critical
**Applies to:** Server-side code that executes system commands

**Compliant:** User input is never interpolated into shell commands. When system commands are necessary, use parameterized execution (e.g., `execFile` with argument arrays, not `exec` with string interpolation).

**Violation:** User input concatenated into strings passed to `exec()`, `system()`, `os.popen()`, `child_process.exec()`, or shell-interpreted commands.

**What to look for:**
- `exec("git clone " + userUrl)`, `exec(\`convert ${filename}\`)`
- `child_process.exec()` with interpolated user input (use `execFile()` or `spawn()` instead)
- Python `os.system()`, `subprocess.run(shell=True)` with user input
- Any path where user-supplied filenames, URLs, or identifiers reach a shell command

**Guidance:** `execFile()` and `spawn()` with argument arrays are safe because they bypass the shell. `exec()` invokes a shell and is vulnerable to metacharacter injection (`;`, `|`, `&&`, `` ` ``).

### INJ-04: Cross-Site Scripting (XSS)

**Severity:** High
**Applies to:** HTML rendering, template engines, client-side DOM manipulation, API responses rendered in browsers

**Compliant:** All user-supplied content is escaped or sanitized before rendering in HTML context. Framework auto-escaping is used (React JSX, Vue templates). `dangerouslySetInnerHTML` or equivalent is only used with sanitized content.

**Violation:** User input inserted into HTML without escaping. Use of `innerHTML`, `dangerouslySetInnerHTML`, `v-html`, or `{!! !!}` with unsanitized user content.

**What to look for:**
- `element.innerHTML = userInput`
- React: `dangerouslySetInnerHTML={{ __html: userContent }}` without DOMPurify or equivalent
- Vue: `v-html="userContent"` without sanitization
- Server-side template rendering with unescaped variables: EJS `<%- variable %>`, Jinja `{{ variable | safe }}`
- `document.write()` with user input
- URL construction: `href={userInput}` allowing `javascript:` protocol

**Guidance:** Modern frameworks (React, Vue, Angular) auto-escape by default. Focus on the escape hatches listed above. Also check for stored XSS: user content saved to the database and later rendered without sanitization.

### INJ-05: Path Traversal

**Severity:** High
**Applies to:** File serving, file upload, template loading, any file system access with user input

**Compliant:** File paths constructed from user input are validated against an allowed base directory using `path.resolve()` and prefix checking. Directory traversal sequences (`../`) are blocked.

**Violation:** User input concatenated into file paths without validation, allowing access to files outside the intended directory.

**What to look for:**
- `fs.readFile(path.join(uploadDir, req.params.filename))` without checking the resolved path stays within `uploadDir`
- `res.sendFile(req.query.file)` with no path validation
- Template inclusion: `render(req.params.template)` allowing `../../etc/passwd`
- Zip extraction without checking entry paths (zip slip vulnerability)

**Guidance:** The safe pattern is: `const resolved = path.resolve(baseDir, userInput); if (!resolved.startsWith(baseDir)) throw Error('path traversal')`. Check for this pattern or its absence.

---

## A04:2021 — Insecure Design

Design-level flaws that cannot be fixed by implementation alone. These are architectural concerns.

### DESIGN-01: Missing Rate Limiting

**Severity:** High
**Applies to:** Authentication endpoints, API endpoints, form submissions, password reset, OTP verification

**Compliant:** Authentication endpoints (login, register, password reset, OTP) have rate limiting. Public API endpoints have rate limiting per client/IP. Rate limiting is implemented server-side.

**Violation:** Login endpoints, password reset endpoints, or OTP verification with no rate limiting, allowing brute force attacks.

**What to look for:**
- Authentication route handlers without rate limiting middleware
- Password reset endpoints that don't limit request frequency per email/IP
- OTP/2FA verification without attempt limiting (allows brute force of 6-digit codes)
- API endpoints without any request rate controls

**Guidance:** Rate limiting can be implemented as middleware (express-rate-limit), at the infrastructure level (API gateway, CDN), or via application logic (Redis counters). Any of these is acceptable. The violation is the complete absence of rate limiting on sensitive endpoints.

### DESIGN-02: Missing Account Lockout

**Severity:** Medium
**Applies to:** Authentication logic, login handlers

**Compliant:** After N failed authentication attempts, the account is temporarily locked, additional verification is required, or progressive delays are introduced.

**Violation:** Unlimited authentication attempts with no lockout, delay, or CAPTCHA escalation.

**What to look for:**
- Login handlers that only check credentials and return success/failure with no tracking of failed attempts
- No database field or cache entry tracking consecutive failures per account
- No conditional logic that changes behavior after repeated failures

**Guidance:** Lockout policies must balance security with availability. Permanent lockout enables denial-of-service. Temporary lockout (15-30 minutes) or exponential delay is preferred.

### DESIGN-03: Business Logic Bypass

**Severity:** High
**Applies to:** Multi-step workflows, payment flows, approval processes

**Compliant:** Multi-step processes enforce step ordering server-side. Each step validates that all prerequisite steps were completed. State is tracked server-side, not in client tokens or hidden form fields.

**Violation:** Step ordering enforced only client-side. Server accepts step 3 without verifying steps 1 and 2 completed. Workflow state stored in client-side tokens that could be tampered with.

**What to look for:**
- Payment flows where the price or plan is sent from the client rather than resolved server-side
- Approval workflows where status transitions aren't validated (e.g., jumping from "draft" to "approved")
- Checkout flows that accept a `price` field in the request body
- Coupon/discount application without server-side validation of eligibility

**Guidance:** The principle is: never trust client-provided state for business-critical decisions. Prices, permissions, workflow state, and eligibility should be resolved from server-side sources of truth.

---

## A05:2021 — Security Misconfiguration

Insecure default configurations, incomplete configurations, open cloud storage, misconfigured HTTP headers, verbose error messages.

### MISCONFIG-01: Debug Mode or Verbose Errors in Production

**Severity:** High
**Applies to:** Application configuration, error handlers, logging setup

**Compliant:** Production error responses return generic messages without stack traces, internal paths, or system information. Debug mode is disabled in production configuration.

**Violation:** Stack traces returned to clients in production. Debug mode enabled without environment restriction. Detailed error objects serialized to HTTP responses.

**What to look for:**
- `app.use((err, req, res, next) => res.status(500).json({ error: err.message, stack: err.stack }))`
- Express `DEBUG=*` or Django `DEBUG=True` without production guards
- `console.error` output leaking into API responses
- Error handlers that return `error.toString()` or the full error object
- Missing environment check: debug features enabled unconditionally

**Guidance:** Error handlers should log the full error server-side and return a generic message to the client. Check that the error handling path distinguishes between development and production environments.

### MISCONFIG-02: Missing Security Headers

**Severity:** Medium
**Applies to:** HTTP server configuration, middleware setup, reverse proxy configuration

**Compliant:** Responses include security headers: `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Content-Security-Policy`.

**Violation:** No security headers configured. Missing HSTS on HTTPS sites. Missing CSP allowing inline scripts.

**What to look for:**
- No `helmet` (Node.js), security middleware, or manual header setting
- Missing `Strict-Transport-Security` header on production HTTPS services
- Missing `Content-Security-Policy` or CSP with `unsafe-inline`, `unsafe-eval`
- `X-Frame-Options` absent (clickjacking risk)

**Guidance:** `helmet` in Express or equivalent middleware in other frameworks covers the basics. Check for its presence in the middleware stack. If headers are set at the reverse proxy/CDN level, that's acceptable but less visible in the code.

### MISCONFIG-03: Default or Weak Credentials

**Severity:** Critical
**Applies to:** Configuration files, seed data, initialization scripts, Docker configurations

**Compliant:** No default credentials in production configuration. Seed data and development defaults are clearly scoped to non-production environments.

**Violation:** Default admin passwords in configuration, database seeds that create admin accounts with known passwords, Docker configurations with default credentials.

**What to look for:**
- Seed scripts: `createUser({ email: 'admin@example.com', password: 'admin' })`
- Docker compose: `POSTGRES_PASSWORD=postgres`, `MYSQL_ROOT_PASSWORD=root`
- Configuration files with `password: changeme`, `secret: default`
- API keys or tokens in configuration that look like defaults (`test123`, `changeme`)

**Guidance:** Development defaults are acceptable IF they're clearly environment-scoped and production requires explicit configuration. Check whether production deployment requires setting these values or falls back to defaults.

---

## A06:2021 — Vulnerable and Outdated Components

Using components with known vulnerabilities, or failing to keep dependencies updated.

### VULN-01: Dependencies with Known Vulnerabilities

**Severity:** Varies (by CVE severity)
**Applies to:** Package manifests (package.json, requirements.txt, go.mod, Cargo.toml, pom.xml)

**Compliant:** Dependencies are regularly audited. No dependencies with known critical or high-severity vulnerabilities in production.

**Violation:** Lock files containing packages with known CVEs. No evidence of dependency auditing (no `npm audit`, `pip-audit`, `govulncheck` in CI).

**What to look for:**
- This rule is best checked by tools (`npm audit`, `pip-audit`, `cargo audit`), not code review. An audit agent should note whether dependency auditing is part of the CI pipeline.
- Check CI configuration files (`.github/workflows/`, `Jenkinsfile`, `.gitlab-ci.yml`) for audit steps
- Check for `.npmrc`, `.npmaudit`, or similar configuration indicating audit practices

**Guidance:** This is primarily a process/tooling check rather than a code review finding. Flag the absence of dependency auditing in CI as a medium-severity finding. Do not attempt to check individual package versions for CVEs — that's tooling's job.

### VULN-02: Unmaintained or Abandoned Dependencies

**Severity:** Medium
**Applies to:** Package manifests

**Compliant:** Key dependencies are actively maintained (recent commits, responsive to issues, regular releases).

**Violation:** Production dependencies that are abandoned (no commits in 2+ years), deprecated, or have known unfixed issues.

**What to look for:**
- Package.json dependencies with deprecation notices
- Imports of packages known to be deprecated (e.g., `request` in Node.js, `moment` for new projects)
- Forked or vendored packages that may not receive security updates

**Guidance:** This is difficult to assess from code alone. Flag packages that are widely known as deprecated. For others, note the dependency for manual review rather than flagging as a definitive finding.

---

## A07:2021 — Identification and Authentication Failures

Failures in authentication mechanisms that allow attackers to compromise passwords, keys, or session tokens.

### AUTH-01: Weak Password Policy

**Severity:** Medium
**Applies to:** User registration, password change handlers, validation logic

**Compliant:** Password requirements enforce minimum length (8+ characters), check against common password lists, or use zxcvbn-style strength estimation.

**Violation:** No password strength requirements. Minimum length < 8 characters. No check against common passwords.

**What to look for:**
- Registration handlers that accept any non-empty password
- Validation like `password.length >= 4` (too short)
- No password strength library or policy enforcement
- Missing password rules in schema validation

**Guidance:** NIST 800-63B recommends minimum 8 characters, checking against breached password lists, and NOT requiring complexity rules (uppercase, special chars). Length and breach checking are more effective than complexity.

### AUTH-02: Insecure Session Management

**Severity:** High
**Applies to:** Session configuration, cookie settings, token management

**Compliant:** Session cookies have `HttpOnly`, `Secure`, `SameSite` attributes set. Session IDs are regenerated after authentication. Sessions have reasonable expiration.

**Violation:** Session cookies without `HttpOnly` (accessible to JavaScript), without `Secure` (sent over HTTP), without `SameSite` (CSRF risk). No session expiration.

**What to look for:**
- Cookie configuration: `httpOnly: false` or missing `httpOnly`
- `secure: false` in production cookie settings
- `sameSite: 'none'` without explicit justification
- JWTs with no expiration (`exp` claim missing)
- Session tokens stored in `localStorage` (accessible to XSS)

**Guidance:** JWTs in `localStorage` are a common but debated pattern. Flag it as a finding with context: if the application is vulnerable to XSS, `localStorage` tokens are exposed. `HttpOnly` cookies are more secure but harder to use with SPAs.

### AUTH-03: Credential Exposure in Logs

**Severity:** Critical
**Applies to:** Logging configuration, error handling, request logging middleware

**Compliant:** Passwords, tokens, API keys, and session identifiers are never logged. Request logging redacts sensitive headers and body fields.

**Violation:** Authentication requests logged with passwords in the body. Authorization headers logged verbatim. Error messages including credentials.

**What to look for:**
- `console.log(req.body)` on authentication endpoints (logs passwords)
- `logger.info('Request', { headers: req.headers })` (logs Authorization header)
- Error messages that include credentials: `throw new Error(\`Auth failed for ${password}\`)`
- Request logging middleware that doesn't exclude `/login`, `/register` bodies or redact sensitive fields

**Guidance:** Structured logging with explicit field selection is safer than dumping entire objects. Check for logging middleware configuration and whether it redacts sensitive fields.

---

## A08:2021 — Software and Data Integrity Failures

Failures related to code and infrastructure that does not protect against integrity violations: insecure CI/CD pipelines, unsigned updates, deserialization of untrusted data.

### INTEGRITY-01: Insecure Deserialization

**Severity:** Critical
**Applies to:** API endpoints, message consumers, file processors

**Compliant:** Deserialized data is validated against a schema before use. Dangerous deserialization methods are avoided or restricted.

**Violation:** Untrusted data deserialized using methods that can execute code or instantiate arbitrary classes.

**What to look for:**
- Python: `pickle.loads(untrusted_data)`, `yaml.load(data)` without `Loader=SafeLoader`
- Java: `ObjectInputStream.readObject()` on untrusted input
- Node.js: `eval(JSON.parse(...))`, `node-serialize`, `funcster`
- PHP: `unserialize()` on user input
- Any deserialization library used on data from external sources without schema validation

**Guidance:** JSON parsing (`JSON.parse()`) is generally safe — it doesn't execute code. The concern is serialization formats that can encode executable behavior (Python pickle, Java serialization, YAML with custom constructors).

### INTEGRITY-02: Missing Webhook Signature Verification

**Severity:** High
**Applies to:** Webhook endpoints, callback handlers, event receivers

**Compliant:** Incoming webhooks verify the request signature using the provider's signing secret before processing.

**Violation:** Webhook endpoints that process events without verifying the `X-Hub-Signature`, `Stripe-Signature`, or equivalent header.

**What to look for:**
- Webhook route handlers that read the body and process it immediately without signature verification
- Stripe webhooks: missing `stripe.webhooks.constructEvent()` call
- GitHub webhooks: missing HMAC-SHA256 signature verification
- Clerk webhooks: missing Svix signature verification
- Any webhook endpoint where the first operation after reading the body is business logic, not signature verification

**Guidance:** Webhook signature verification typically must happen before body parsing middleware consumes the raw body. Check that the raw body is available for verification (Express: `express.raw()`, not `express.json()` for webhook routes).

---

## A09:2021 — Security Logging and Monitoring Failures

Insufficient logging of security-relevant events, or failure to detect and respond to active attacks.

### LOG-01: Missing Authentication Event Logging

**Severity:** Medium
**Applies to:** Authentication handlers, authorization middleware

**Compliant:** Successful and failed login attempts are logged with timestamp, user identifier, IP address, and outcome. Account lockouts, password changes, and privilege escalations are logged.

**Violation:** Login handlers with no logging. Failed authentication attempts silently returning 401. No audit trail for privilege changes.

**What to look for:**
- Login handlers that return success/failure without any logging call
- Password reset flows with no logging of who requested the reset
- Role/permission changes with no audit log entry
- Absence of structured logging in authentication code paths

**Guidance:** The logging itself doesn't need to be in the route handler — centralized middleware or event-based logging is fine. The check is whether authentication events are captured *somewhere* in the system.

### LOG-02: Sensitive Data in Logs

**Severity:** High
**Applies to:** Logging statements throughout the codebase

**Compliant:** Logs never contain passwords, tokens, credit card numbers, social security numbers, or other PII. Sensitive fields are redacted or masked.

**Violation:** Logging raw request bodies that contain credentials. Logging full user objects that include password hashes. Logging PII without redaction.

**What to look for:**
- `logger.info('User created', user)` where `user` object includes `passwordHash` or `ssn`
- `console.log('Payment', { cardNumber, cvv })` or equivalent
- Error logging that includes full request context: `logger.error('Failed', { req })` dumping headers/body
- Logging database query parameters that include sensitive values

**Guidance:** Overlaps with AUTH-03 (credential exposure in logs) but broader — covers PII, financial data, health data. The fix is structured logging with explicit field inclusion (allowlist) rather than object spreading (blocklist is error-prone).

---

## A10:2021 — Server-Side Request Forgery (SSRF)

SSRF occurs when a web application fetches a remote resource without validating the user-supplied URL, allowing attackers to make requests to internal services.

### SSRF-01: Unvalidated URL Fetching

**Severity:** High
**Applies to:** URL fetching, webhook delivery, image/file processing, link preview generation

**Compliant:** User-supplied URLs are validated against an allowlist of permitted domains or protocols. Internal/private IP ranges are blocked. URL scheme is restricted to `http`/`https`.

**Violation:** Server-side HTTP requests made to user-supplied URLs without validation of the target host, allowing requests to internal services, cloud metadata endpoints, or localhost.

**What to look for:**
- `fetch(userProvidedUrl)`, `axios.get(userUrl)`, `http.get(userUrl)` where `userUrl` comes from request input
- Webhook delivery: `fetch(webhook.url)` where the URL was registered by a user
- Image processing: downloading images from user-provided URLs
- No check for private IP ranges: `127.0.0.1`, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, `169.254.169.254` (cloud metadata)
- URL validation that only checks the initial URL, not following redirects to internal targets

**Guidance:** SSRF is especially dangerous in cloud environments where `http://169.254.169.254/` exposes instance metadata (AWS IMDSv1, GCP, Azure). The presence of cloud deployment + user-provided URLs + server-side fetching is a high-risk combination. DNS rebinding can bypass hostname validation — the most robust defense is network-level controls (metadata endpoint firewalling), but application-level URL validation is still valuable defense in depth.

---

## Cross-Cutting Concerns

These are not OWASP categories but analysis patterns that span multiple rules and components.

### CROSS-01: PII Data Flow Tracing

**Scope:** Full codebase
**Relates to:** CRYPTO-01, LOG-02, AUTH-03

**Objective:** Trace personally identifiable information (names, emails, phone numbers, addresses, SSNs, health data) from input (API endpoints, form submissions, data imports) through processing and storage to output (API responses, logs, error messages, exports).

**What to verify:**
- PII is encrypted at rest (CRYPTO-01)
- PII is not logged (LOG-02)
- PII is not included in error messages sent to clients
- PII access is authorized (BAC-01)
- PII deletion capability exists if required by privacy policy

### CROSS-02: Authentication Chain Completeness

**Scope:** All API entry points
**Relates to:** BAC-01, BAC-03, AUTH-02

**Objective:** Verify that every API endpoint that should require authentication actually has authentication middleware or checks. Enumerate all routes and verify coverage.

**What to verify:**
- Every route is either explicitly public or has authentication middleware
- No route was accidentally added without auth (common in rapid development)
- Authentication middleware runs before business logic
- WebSocket connections verify auth on connection, not just on first message

### CROSS-03: Secrets Management

**Scope:** Full codebase + configuration
**Relates to:** CRYPTO-04, MISCONFIG-03

**Objective:** Verify no secrets are present in source code, and that the application has a consistent pattern for loading secrets from the environment.

**What to verify:**
- No hardcoded secrets (CRYPTO-04)
- Consistent pattern for secret access (env vars, secret manager, encrypted config)
- No secrets in committed configuration files
- `.gitignore` includes `.env`, credential files
- No secrets in CI/CD pipeline configuration files committed to the repo
