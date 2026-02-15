# Implementation Plan: DX Improvements (Commercial Distribution)

**Priority:** 🟡 HIGH - Reduces adoption friction
**Estimated Time:** 16-24 hours
**Owner:** Product team
**Branch:** `feature/dx-improvements`

## Overview

Improve developer experience while maintaining commercial model. The CLI is a **paid product**, not distributed via npm. Focus on reducing friction points that prevent developers from reaching value, while preserving monetization through license keys.

**Commercial Distribution Model:**
- CLI: Licensed product (download from website, requires auth)
- API/SDK: Programmatic access for paid users
- GitHub Action: Freemium (free for public repos, paid for private)
- Web Dashboard: SaaS subscription

---

## Installation & Distribution Strategy

### Current Problems
- Manual git clone + Bun installation
- No clear "how to get started"
- Confusing mix of CLI and web dashboard

### Revised Model (No Free npm)

**Tier 1: Free Trial (Public Repos)**
```bash
# Download install script
curl -fsSL https://get.code-auditor.com | sh

# Authenticate with trial key
code-auditor login

# Run on public repo (GitHub verifies)
code-auditor .
```
- Limited to public repositories (GitHub API verifies)
- 15 audits/month free
- Watermarked reports
- Upgrade CTA in output

**Tier 2: Pro License ($39/mo)**
```bash
# Same install script
curl -fsSL https://get.code-auditor.com | sh

# Authenticate with Pro license key
code-auditor login --key=<license-key>

# Unlimited audits, private repos
code-auditor .
```
- License key tied to user account
- Works offline after initial activation
- Private repository support

**Tier 3: Team License ($249/mo)**
- Shared license keys for team
- Dashboard access
- API/SDK access for CI/CD

---

## Wave 1: Install Script & License System (8-12 hours)

### Task 1.1: Create Install Script (4 hours)

**File:** `install.sh` (hosted at https://get.code-auditor.com)

```bash
#!/bin/bash
set -e

# AI Code Auditor Install Script
# Usage: curl -fsSL https://get.code-auditor.com | sh

VERSION="1.0.0"
INSTALL_DIR="${HOME}/.code-auditor"
BIN_DIR="${HOME}/.local/bin"

echo "🚀 Installing AI Code Auditor v${VERSION}..."

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "${ARCH}" in
  x86_64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *) echo "❌ Unsupported architecture: ${ARCH}"; exit 1 ;;
esac

# Download binary
DOWNLOAD_URL="https://releases.code-auditor.com/v${VERSION}/code-auditor-${OS}-${ARCH}"

echo "📦 Downloading from ${DOWNLOAD_URL}..."
mkdir -p "${INSTALL_DIR}"
curl -fsSL "${DOWNLOAD_URL}" -o "${INSTALL_DIR}/code-auditor"
chmod +x "${INSTALL_DIR}/code-auditor"

# Add to PATH
mkdir -p "${BIN_DIR}"
ln -sf "${INSTALL_DIR}/code-auditor" "${BIN_DIR}/code-auditor"

# Verify installation
if command -v code-auditor &> /dev/null; then
  echo "✅ Installed successfully!"
  echo ""
  echo "Get started:"
  echo "  code-auditor login     # Authenticate"
  echo "  code-auditor .         # Run your first audit"
  echo ""
  echo "Need a license? Visit https://code-auditor.com/pricing"
else
  echo "⚠️  Installed but not in PATH"
  echo "Add to your shell profile:"
  echo "  export PATH=\"\${HOME}/.local/bin:\${PATH}\""
fi
```

**Build Process:**

Create binary releases for each platform:
```bash
# In package.json
"scripts": {
  "build:linux-amd64": "bun build src/cli.ts --compile --target=bun-linux-x64 --outfile=dist/code-auditor-linux-amd64",
  "build:linux-arm64": "bun build src/cli.ts --compile --target=bun-linux-arm64 --outfile=dist/code-auditor-linux-arm64",
  "build:darwin-amd64": "bun build src/cli.ts --compile --target=bun-darwin-x64 --outfile=dist/code-auditor-darwin-amd64",
  "build:darwin-arm64": "bun build src/cli.ts --compile --target=bun-darwin-arm64 --outfile=dist/code-auditor-darwin-arm64",
  "build:all": "bun run build:linux-amd64 && bun run build:linux-arm64 && bun run build:darwin-amd64 && bun run build:darwin-arm64"
}
```

**Hosting:**
- Host install.sh at get.code-auditor.com (Vercel Edge Function or S3)
- Host binaries at releases.code-auditor.com (S3 + CloudFront)
- Add version manifest for updates

**Acceptance Criteria:**
- [ ] Install script downloads correct binary for OS/arch
- [ ] Binary is executable after install
- [ ] `code-auditor --version` works after install
- [ ] Works on macOS (Intel + Apple Silicon) and Linux
- [ ] Instructions shown after successful install

---

### Task 1.2: License Key System (4 hours)

**File:** `src/license.ts`

```typescript
import { webcrypto } from 'node:crypto'

export interface License {
  key: string
  email: string
  plan: 'FREE' | 'PRO' | 'TEAM' | 'ENTERPRISE'
  expiresAt: Date | null  // null = lifetime
  features: {
    privateRepos: boolean
    unlimitedAudits: boolean
    apiAccess: boolean
    teamDashboard: boolean
  }
}

// License key format: CAUD-XXXX-XXXX-XXXX-XXXX
// - CAUD prefix (Code Auditor)
// - 16 char random (URL-safe base64)
// - Signed with HMAC

export async function generateLicenseKey(
  email: string,
  plan: License['plan']
): Promise<string> {
  // Generate random portion
  const randomBytes = webcrypto.getRandomValues(new Uint8Array(12))
  const random = Buffer.from(randomBytes).toString('base64url')

  // Create license data
  const data = { email, plan, timestamp: Date.now() }
  const dataStr = JSON.stringify(data)

  // Sign with HMAC
  const secret = process.env.LICENSE_SECRET!
  const encoder = new TextEncoder()
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )

  const signature = await webcrypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(dataStr)
  )

  const sig = Buffer.from(signature).toString('base64url').substring(0, 8)

  // Format: CAUD-{random}-{sig}
  const formatted = `CAUD-${random.substring(0, 4)}-${random.substring(4, 8)}-${random.substring(8, 12)}-${sig}`

  return formatted
}

export async function verifyLicenseKey(
  key: string
): Promise<License | null> {
  // Basic format check
  if (!key.startsWith('CAUD-') || key.length !== 24) {
    return null
  }

  // Call API to verify (requires internet)
  try {
    const response = await fetch('https://api.code-auditor.com/v1/licenses/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
    })

    if (!response.ok) return null

    const license = await response.json()
    return license
  } catch {
    // Offline mode: check local cache
    return getOfflineLicense(key)
  }
}

function getOfflineLicense(key: string): License | null {
  // Read from ~/.code-auditor/license.json
  // Allows offline usage after initial activation
  const licensePath = `${process.env.HOME}/.code-auditor/license.json`

  try {
    const data = Bun.file(licensePath)
    const cached = JSON.parse(await data.text())

    if (cached.key === key) {
      return cached
    }
  } catch {
    return null
  }

  return null
}
```

**License Activation Flow:**
```typescript
// src/commands/login.ts

export async function loginCommand(options: { key?: string }) {
  if (options.key) {
    // Activate with license key
    const license = await verifyLicenseKey(options.key)

    if (!license) {
      console.error('❌ Invalid license key')
      console.log('Get a license at https://code-auditor.com/pricing')
      process.exit(1)
    }

    // Save license locally
    await saveLicense(license)

    console.log('✅ License activated!')
    console.log(`Plan: ${license.plan}`)
    console.log(`Email: ${license.email}`)

    if (license.plan === 'FREE') {
      console.log('Limitations: Public repos only, 15 audits/month')
      console.log('Upgrade: https://code-auditor.com/pricing')
    }
  } else {
    // Interactive login (opens browser)
    console.log('🔐 Opening browser for authentication...')

    const authUrl = 'https://code-auditor.com/cli-login'
    // Open browser, poll for token
    // ... OAuth-style flow
  }
}
```

**Acceptance Criteria:**
- [ ] License keys can be generated (admin dashboard)
- [ ] License keys can be verified (API endpoint)
- [ ] License cached locally for offline use
- [ ] `code-auditor login` activates license
- [ ] `code-auditor login --key=XXX` works
- [ ] Plan limits enforced (FREE vs PRO vs TEAM)

---

### Task 1.3: Update CLI to Check License (2 hours)

**File:** `src/cli.ts`

```typescript
import { getLicense, requiresLicense } from './license'

async function main() {
  const command = process.argv[2]

  // Commands that don't need license
  if (['login', 'version', 'help'].includes(command)) {
    // ... handle these
    return
  }

  // Check license for audit commands
  const license = await getLicense()

  if (!license) {
    console.error('❌ No active license')
    console.log('')
    console.log('Activate a license:')
    console.log('  code-auditor login')
    console.log('')
    console.log('Get a license:')
    console.log('  https://code-auditor.com/pricing')
    console.log('')
    console.log('Try our free trial (public repos only):')
    console.log('  https://code-auditor.com/trial')
    process.exit(1)
  }

  // Check if trying to audit private repo with FREE plan
  if (license.plan === 'FREE') {
    const isPublic = await checkIfPublicRepo()

    if (!isPublic) {
      console.error('❌ Private repositories require a Pro license')
      console.log('Upgrade at https://code-auditor.com/pricing')
      process.exit(1)
    }
  }

  // Proceed with audit
  // ...
}
```

**Acceptance Criteria:**
- [ ] Audits require active license
- [ ] FREE plan limited to public repos
- [ ] PRO/TEAM plans work for private repos
- [ ] Helpful error messages with upgrade links
- [ ] Offline mode works (cached license)

---

## Wave 2: Error Messages & Progress (4-6 hours)

### Task 2.1: Improve Missing API Key Error (1 hour)

**File:** `src/cli.ts`

**Before:**
```
ANTHROPIC_API_KEY environment variable is not set.
```

**After:**
```
❌ Missing Anthropic API Key

AI Code Auditor uses Claude to analyze your code.
This requires an Anthropic API key.

Quick Setup (2 minutes):
  1. Sign up: https://console.anthropic.com/signup
  2. Create key: https://console.anthropic.com/api-keys
  3. Copy your key (starts with sk-ant-...)

Then set it in your terminal:
  export ANTHROPIC_API_KEY=sk-ant-xxx

Make it permanent (add to ~/.zshrc or ~/.bashrc):
  echo 'export ANTHROPIC_API_KEY=sk-ant-xxx' >> ~/.zshrc

💰 Cost: ~$0.01-0.10 per audit
    First $5 free for new Anthropic users

Questions? https://docs.code-auditor.com/setup/api-key
```

**Acceptance Criteria:**
- [ ] Error explains WHAT is needed
- [ ] Error explains HOW to get it (step-by-step)
- [ ] Error mentions cost upfront
- [ ] Error links to docs for help

---

### Task 2.2: Add Progress Indicators (3 hours)

**File:** `src/cli.ts`

**Install ora or cli-progress:**
```bash
bun add ora
```

**Implementation:**
```typescript
import ora from 'ora'

async function runAudit(files: FileContent[]) {
  const spinner = ora({
    text: 'Preparing audit...',
    color: 'cyan',
  }).start()

  try {
    // Discovery
    spinner.text = `Scanning ${files.length} files...`
    await sleep(500) // Brief pause so user sees message

    // Chunking
    spinner.text = 'Creating chunks...'
    const chunks = createChunks(files)

    // Orchestrator
    spinner.text = 'Running 5 AI agents in parallel...'

    const results = await runWithProgress(chunks, (progress) => {
      const { completed, total, current } = progress
      spinner.text = `Analyzing... ${completed}/${total} agents complete (${current})`
    })

    spinner.succeed('Analysis complete!')

    // Show results
    printReport(results)
  } catch (error) {
    spinner.fail('Audit failed')
    throw error
  }
}

// Update orchestrator to report progress
async function runWithProgress(
  chunks: Chunk[],
  onProgress: (progress: Progress) => void
): Promise<AgentResult[]> {
  const agents = [correctness, security, performance, maintainability, edgeCases]

  let completed = 0

  const promises = agents.map(async (agent) => {
    onProgress({ completed, total: agents.length, current: agent.name })

    const result = await runAgent(agent, chunks)

    completed++
    onProgress({ completed, total: agents.length, current: agent.name })

    return result
  })

  return Promise.all(promises)
}
```

**Acceptance Criteria:**
- [ ] Spinner shown during each phase (scan, chunk, analyze)
- [ ] Progress updates as agents complete
- [ ] Success checkmark when done
- [ ] Failure X if error occurs
- [ ] Total time shown

---

### Task 2.3: Add Other Command Improvements (2 hours)

**Commands to add:**

1. **`code-auditor --version`**
   ```typescript
   if (args['--version'] || args['-v']) {
     console.log(`code-auditor v${VERSION}`)
     console.log(`Bun v${Bun.version}`)
     process.exit(0)
   }
   ```

2. **`code-auditor doctor`**
   ```typescript
   async function doctorCommand() {
     console.log('🏥 Running diagnostics...\n')

     // Check license
     const license = await getLicense()
     if (license) {
       console.log('✅ License')
       console.log(`   Plan: ${license.plan}`)
       console.log(`   Email: ${license.email}`)
     } else {
       console.log('❌ License')
       console.log('   Run: code-auditor login')
     }

     // Check API key
     if (process.env.ANTHROPIC_API_KEY) {
       console.log('✅ Anthropic API Key set')

       // Test API connection
       try {
         await testAnthropicConnection()
         console.log('✅ Anthropic API reachable')
       } catch {
         console.log('❌ Anthropic API unreachable')
       }
     } else {
       console.log('❌ Anthropic API Key missing')
     }

     // Check version
     const latest = await getLatestVersion()
     if (VERSION < latest) {
       console.log('⚠️  Update available')
       console.log(`   Current: v${VERSION}`)
       console.log(`   Latest: v${latest}`)
       console.log('   Run: code-auditor update')
     } else {
       console.log('✅ Version up to date')
     }

     console.log('\n🎉 Everything looks good!')
   }
   ```

3. **`code-auditor demo`**
   ```typescript
   async function demoCommand() {
     console.log('🎬 Running demo audit...\n')
     console.log('This demo shows what an audit looks like without using your API quota.')
     console.log('We\'ll analyze sample code with intentional bugs.\n')

     // Use pre-generated mock results
     const mockReport = loadMockReport()
     printReport(mockReport)

     console.log('\n🎓 Ready to try on your own code?')
     console.log('   code-auditor login   # Get started')
     console.log('   code-auditor .       # Audit current directory')
   }
   ```

**Acceptance Criteria:**
- [ ] `code-auditor --version` shows version
- [ ] `code-auditor doctor` checks setup
- [ ] `code-auditor demo` shows mock results
- [ ] All commands have `--help` text

---

## Wave 3: Documentation & Onboarding (4-6 hours)

### Task 3.1: Rewrite README (2 hours)

**Current:** 312 lines, quick start at line 36

**Target:** <150 lines, quick start at top

**Structure:**
```markdown
# AI Code Auditor

> Catch bugs AI coding assistants miss. 30-second code review by 5 AI specialists.

## Quick Start (60 seconds)

```bash
# Install
curl -fsSL https://get.code-auditor.com | sh

# Activate free trial
code-auditor login

# Run your first audit
code-auditor .
```

**Works with:** TypeScript, JavaScript, Python, Go, Rust, and more.

---

## What You Get

- **5 AI Specialists** analyze your code in parallel:
  - 🎯 Correctness - Logic errors, type safety
  - 🔒 Security - OWASP Top 10, vulnerabilities
  - ⚡ Performance - N+1 queries, bottlenecks
  - 🛠️ Maintainability - Complexity, code smells
  - 🔍 Edge Cases - Boundary conditions, error handling

- **30-Second Analysis** - Faster than manual review
- **Detailed Reports** - Actionable suggestions, not just lint warnings
- **GitHub Action** - Auto-review every PR
- **Team Dashboard** - Track quality trends over time

---

## Pricing

- **Free Trial**: 15 audits/month, public repos only
- **Pro**: $39/month, unlimited audits, private repos
- **Team**: $249/month, 10 users, dashboard, API access
- **Enterprise**: Custom pricing, SSO, compliance

[View detailed pricing →](https://code-auditor.com/pricing)

---

## Documentation

- [Installation](docs/INSTALLATION.md)
- [GitHub Action Setup](docs/GITHUB-ACTION.md)
- [CLI Reference](docs/CLI-GUIDE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)

---

## Example Output

[Screenshot or GIF of terminal output]

---

## Questions?

- **Docs**: https://docs.code-auditor.com
- **Email**: support@code-auditor.com
- **Issues**: https://github.com/yourusername/ai-code-auditor/issues

---

## License

Commercial software. See [LICENSE](LICENSE) for details.
```

**Acceptance Criteria:**
- [ ] README is <150 lines
- [ ] Quick Start is lines 1-20
- [ ] Installation is one command
- [ ] Pricing is transparent
- [ ] Links to detailed docs
- [ ] Shows example output (screenshot/GIF)

---

### Task 3.2: Create Getting Started Guide (2 hours)

**File:** `docs/GETTING-STARTED.md`

**Content:**
- Step 1: Install
- Step 2: Activate license
- Step 3: Set Anthropic API key
- Step 4: Run first audit
- Step 5: Interpret results
- Step 6: Set up GitHub Action (optional)
- Step 7: Invite team (optional)

Each step with screenshots/examples.

**Acceptance Criteria:**
- [ ] Complete walkthrough from install to team setup
- [ ] Screenshots for each step
- [ ] Troubleshooting tips inline
- [ ] Takes <10 minutes to complete

---

### Task 3.3: Create Troubleshooting Guide (2 hours)

**File:** `docs/TROUBLESHOOTING.md`

**Common Issues:**
1. "Invalid license key"
2. "ANTHROPIC_API_KEY not set"
3. "Rate limit exceeded"
4. "Audit failed with API error"
5. "Command not found: code-auditor"
6. "Permission denied"
7. "Unsupported architecture"

Each with:
- Symptom (what error looks like)
- Cause (why it happens)
- Solution (step-by-step fix)

**Acceptance Criteria:**
- [ ] Covers top 10 errors from user testing
- [ ] Solutions are copy-paste commands
- [ ] Links to more detailed docs
- [ ] Searchable (good headings)

---

## Summary & Validation

### Total Time: 16-24 hours

**Breakdown:**
- Wave 1: Install & License - 8-12 hours
- Wave 2: Error Messages & Progress - 4-6 hours
- Wave 3: Documentation - 4-6 hours

### Pre-Launch Checklist

**Installation:**
- [ ] Install script works on macOS (Intel + ARM)
- [ ] Install script works on Linux (x64 + ARM)
- [ ] Binary is code-signed (macOS)
- [ ] Hosted at https://get.code-auditor.com
- [ ] Releases at https://releases.code-auditor.com

**Licensing:**
- [ ] License generation API works
- [ ] License verification API works
- [ ] Offline mode works (cached license)
- [ ] Plan limits enforced (FREE vs PRO)
- [ ] Private repo detection works

**UX:**
- [ ] Error messages are helpful
- [ ] Progress indicators show status
- [ ] `--version`, `doctor`, `demo` commands work
- [ ] Time to first value <5 minutes

**Documentation:**
- [ ] README <150 lines
- [ ] Quick start at top
- [ ] Getting started guide complete
- [ ] Troubleshooting guide covers common errors

### Success Metrics

**Before:** 70% abandonment, 20-minute TTFV

**After:**
- Installation: 1 command, 30 seconds
- Activation: 1 command, 1 minute
- First audit: 1 command, 30 seconds
- **TTFV: <5 minutes** (target achieved)
- **Abandonment: <30%** (estimate)

### Commercial Model Notes

**Why No Free npm:**
- Maintains product value (not just "another CLI tool")
- Enables freemium (free trial → paid upgrade)
- Controls distribution (metrics, licensing)
- Prevents piracy/abuse

**Freemium Strategy:**
- Free tier on public repos (GitHub verifies)
- Watermarked reports ("Upgrade to remove")
- Usage limits (15/month)
- Clear upgrade path

**This preserves monetization while reducing friction.**
