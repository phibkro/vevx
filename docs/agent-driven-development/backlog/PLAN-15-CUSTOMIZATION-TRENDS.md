# Implementation Plan: Customization & Quality Trends

**Priority:** 🟡 HIGH - Product differentiation features
**Scope:** apps/web + apps/cli + packages/core
**Sprint:** Sprint 3 (2 weeks)
**Estimated Time:** 16-20 hours
**Branch:** `feature/customization-trends`

## Overview

Add customization features that let users tune analysis to their needs, and trend tracking to show quality improvements over time.

**Current State:**
- Fixed agent weights (not customizable)
- Single overall score (no breakdown shown)
- No history tracking
- No comparison views
- Manual configuration

**Target State:**
- Custom weight profiles (security-focused, performance-critical, move-fast, balanced)
- Score breakdown showing calculation details
- Quality trend tracking over time
- Comparison views (PR vs main, before vs after)
- Interactive configuration wizard (`code-audit init`)

---

## User Stories

### Story 1: Custom Agent Weight Profiles

**As a** security-conscious team
**I want** to prioritize security issues over other concerns
**So that** I can find vulnerabilities before shipping

**Acceptance Criteria:**
- [ ] 4 built-in profiles: security-focused, performance-critical, move-fast, balanced
- [ ] Custom profile creation via config file
- [ ] Profile selection via CLI flag (`--profile security`)
- [ ] Profile preview showing weight distribution
- [ ] Dashboard profile management (save/share profiles)

**Story Points:** 5

---

### Story 2: Score Breakdown & Calculation Details

**As a** developer
**I want** to see how the overall score was calculated
**So that** I understand which areas need improvement

**Acceptance Criteria:**
- [ ] Visual breakdown showing each agent's contribution
- [ ] Formula display: `overall = (correctness × 0.22) + (security × 0.22) + ...`
- [ ] Before/after impact preview when changing weights
- [ ] Export breakdown as JSON/CSV

**Story Points:** 3

---

### Story 3: Quality Trend Tracking

**As a** team lead
**I want** to track code quality over time
**So that** I can measure improvement and catch regressions

**Acceptance Criteria:**
- [ ] Store historical audit results in database
- [ ] Trend charts (overall score + per-agent scores)
- [ ] Time range filters (7d, 30d, 90d, all time)
- [ ] Regression alerts (score drops >1 point)
- [ ] Export trend data as CSV

**Story Points:** 5

---

### Story 4: Comparison Views

**As a** developer reviewing a PR
**I want** to compare audit scores before and after changes
**So that** I can verify I'm improving quality, not degrading it

**Acceptance Criteria:**
- [ ] CLI: Compare current code vs git ref (`--compare main`)
- [ ] Dashboard: PR comparison view (this PR vs target branch)
- [ ] Diff highlighting (new findings vs resolved findings)
- [ ] Visual score delta (+0.5, -1.2, etc.)
- [ ] Filter by changed files only

**Story Points:** 5

---

### Story 5: Configuration Wizard

**As a** new user
**I want** a guided setup process
**So that** I can configure the tool correctly without reading docs

**Acceptance Criteria:**
- [ ] `code-audit init` command
- [ ] Interactive prompts (language, framework, priorities)
- [ ] Profile recommendation based on answers
- [ ] Generates `.code-audit.json` with best practices
- [ ] Optional: Dashboard API key setup

**Story Points:** 3

---

## Implementation

### Wave 1: Custom Weight Profiles [6-8h]

#### Task 1.1: Define Profile Schema [1h]

**Create:** `packages/types/src/profiles.ts`

```typescript
export interface AgentWeightProfile {
  name: string
  description: string
  weights: {
    correctness: number
    security: number
    performance: number
    maintainability: number
    edgeCases: number
    accessibility: number
    documentation: number
  }
}

export const BUILTIN_PROFILES: Record<string, AgentWeightProfile> = {
  balanced: {
    name: 'Balanced',
    description: 'Equal emphasis on all quality dimensions',
    weights: {
      correctness: 0.22,
      security: 0.22,
      performance: 0.13,
      maintainability: 0.15,
      edgeCases: 0.13,
      accessibility: 0.10,
      documentation: 0.05,
    },
  },
  'security-focused': {
    name: 'Security Focused',
    description: 'Prioritizes security vulnerabilities and auth issues',
    weights: {
      correctness: 0.15,
      security: 0.40, // 40% on security
      performance: 0.10,
      maintainability: 0.10,
      edgeCases: 0.15,
      accessibility: 0.05,
      documentation: 0.05,
    },
  },
  'performance-critical': {
    name: 'Performance Critical',
    description: 'Optimized for high-performance systems',
    weights: {
      correctness: 0.20,
      security: 0.15,
      performance: 0.35, // 35% on performance
      maintainability: 0.10,
      edgeCases: 0.15,
      accessibility: 0.00,
      documentation: 0.05,
    },
  },
  'move-fast': {
    name: 'Move Fast',
    description: 'Focuses on correctness and critical bugs only',
    weights: {
      correctness: 0.50, // 50% on correctness
      security: 0.30, // 30% on security
      performance: 0.05,
      maintainability: 0.05,
      edgeCases: 0.10,
      accessibility: 0.00,
      documentation: 0.00,
    },
  },
}

// Validate weights sum to 1.0
export function validateProfile(profile: AgentWeightProfile): boolean {
  const sum = Object.values(profile.weights).reduce((a, b) => a + b, 0)
  return Math.abs(sum - 1.0) < 0.001
}
```

**Tests:**
```typescript
describe('Agent Weight Profiles', () => {
  test('all builtin profiles sum to 1.0', () => {
    Object.values(BUILTIN_PROFILES).forEach(profile => {
      expect(validateProfile(profile)).toBe(true)
    })
  })

  test('security-focused prioritizes security', () => {
    const profile = BUILTIN_PROFILES['security-focused']
    expect(profile.weights.security).toBeGreaterThan(0.35)
  })
})
```

#### Task 1.2: Update Orchestrator to Use Profiles [2-3h]

**Update:** `packages/core/src/orchestrator.ts`

```typescript
import { AgentWeightProfile, BUILTIN_PROFILES } from '@ai-code-auditor/types'

export interface AuditOptions {
  // ... existing options
  profile?: string | AgentWeightProfile // Profile name or custom profile
}

export async function runAudit(
  files: FileContent[],
  options: AuditOptions = {}
): Promise<AuditResult> {
  // Load profile
  let profile: AgentWeightProfile
  if (!options.profile) {
    profile = BUILTIN_PROFILES.balanced
  } else if (typeof options.profile === 'string') {
    profile = BUILTIN_PROFILES[options.profile] || BUILTIN_PROFILES.balanced
  } else {
    profile = options.profile
    if (!validateProfile(profile)) {
      throw new Error('Custom profile weights must sum to 1.0')
    }
  }

  // Apply profile weights to agents
  const agentsWithWeights = agents.map(agent => ({
    ...agent,
    weight: profile.weights[agent.name] || 0,
  }))

  // Run agents with custom weights
  const results = await Promise.allSettled(
    agentsWithWeights.map(agent => runAgent(agent, files, options))
  )

  // Calculate weighted score using profile weights
  const overallScore = calculateWeightedScore(results, profile)

  return {
    overallScore,
    profile: profile.name,
    agents: results,
    // ...
  }
}
```

**Tests:**
```typescript
describe('Orchestrator with Profiles', () => {
  test('uses balanced profile by default', async () => {
    const result = await runAudit(mockFiles, {})
    expect(result.profile).toBe('Balanced')
  })

  test('applies security-focused profile weights', async () => {
    const result = await runAudit(mockFiles, { profile: 'security-focused' })
    const securityAgent = result.agents.find(a => a.name === 'security')
    expect(securityAgent.weight).toBe(0.40)
  })

  test('accepts custom profile', async () => {
    const customProfile: AgentWeightProfile = {
      name: 'Custom',
      description: 'Test',
      weights: { correctness: 1.0, security: 0.0, /* ... */ },
    }
    const result = await runAudit(mockFiles, { profile: customProfile })
    expect(result.profile).toBe('Custom')
  })

  test('rejects invalid custom profile', async () => {
    const invalidProfile = {
      name: 'Invalid',
      weights: { correctness: 0.5, security: 0.3 }, // Sum = 0.8, not 1.0
    }
    await expect(runAudit(mockFiles, { profile: invalidProfile })).rejects.toThrow()
  })
})
```

#### Task 1.3: CLI Profile Support [1-2h]

**Update:** `apps/cli/src/cli.ts`

```typescript
program
  .command('audit')
  .option('-p, --profile <name>', 'Weight profile (balanced, security-focused, performance-critical, move-fast)', 'balanced')
  .option('--list-profiles', 'List available profiles')
  .action(async (path, options) => {
    if (options.listProfiles) {
      console.log('Available Profiles:\n')
      Object.values(BUILTIN_PROFILES).forEach(profile => {
        console.log(`  ${profile.name}`)
        console.log(`    ${profile.description}`)
        console.log(`    Weights: ${JSON.stringify(profile.weights, null, 2)}\n`)
      })
      return
    }

    const result = await runAudit(files, { profile: options.profile })
    // Display which profile was used
    console.log(`Profile: ${result.profile}\n`)
  })
```

#### Task 1.4: Dashboard Profile Management [2-3h]

**Create:** `apps/web/app/dashboard/profiles/page.tsx`

```typescript
'use client'

import { useState } from 'react'
import { BUILTIN_PROFILES } from '@ai-code-auditor/types'

export default function ProfilesPage() {
  const [selectedProfile, setSelectedProfile] = useState('balanced')
  const profile = BUILTIN_PROFILES[selectedProfile]

  return (
    <div>
      <h1>Agent Weight Profiles</h1>

      {/* Profile selector */}
      <div className="grid grid-cols-2 gap-4">
        {Object.entries(BUILTIN_PROFILES).map(([key, p]) => (
          <ProfileCard
            key={key}
            profile={p}
            selected={key === selectedProfile}
            onClick={() => setSelectedProfile(key)}
          />
        ))}
      </div>

      {/* Weight visualization */}
      <WeightChart profile={profile} />

      {/* Custom profile editor */}
      <CustomProfileEditor />
    </div>
  )
}
```

**Create:** Database schema for custom profiles

```prisma
// apps/web/prisma/schema.prisma

model CustomProfile {
  id          String   @id @default(cuid())
  teamId      String
  team        Team     @relation(fields: [teamId], references: [id], onDelete: Cascade)

  name        String
  description String?
  weights     Json     // Store weights as JSON

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([teamId])
}
```

**Create:** API endpoint for custom profiles

```typescript
// apps/web/app/api/profiles/route.ts

export async function POST(req: Request) {
  const { userId } = auth()
  if (!userId) return unauthorized()

  const body = await req.json()
  const { name, description, weights } = profileSchema.parse(body)

  // Validate weights sum to 1.0
  if (!validateProfile({ name, description, weights })) {
    return json({ error: 'Weights must sum to 1.0' }, { status: 400 })
  }

  const profile = await db.customProfile.create({
    data: {
      teamId: user.teamId,
      name,
      description,
      weights,
    },
  })

  return json(profile)
}
```

---

### Wave 2: Score Breakdown & Visualization [3-4h]

#### Task 2.1: Score Breakdown Component [2h]

**Create:** `apps/web/components/score-breakdown.tsx`

```typescript
interface ScoreBreakdownProps {
  result: AuditResult
}

export function ScoreBreakdown({ result }: ScoreBreakdownProps) {
  const { overallScore, profile, agents } = result

  // Calculate each agent's contribution to overall score
  const contributions = agents.map(agent => ({
    name: agent.name,
    score: agent.score,
    weight: agent.weight,
    contribution: agent.score * agent.weight,
  }))

  return (
    <div className="space-y-4">
      <h3>Score Breakdown</h3>

      {/* Overall score */}
      <div className="text-4xl font-bold">
        {overallScore.toFixed(1)}/10
      </div>

      {/* Formula display */}
      <div className="text-sm text-muted-foreground">
        Overall = {contributions.map((c, i) => (
          <span key={c.name}>
            ({c.name} × {c.weight.toFixed(2)})
            {i < contributions.length - 1 && ' + '}
          </span>
        ))}
      </div>

      {/* Visual breakdown */}
      <div className="space-y-2">
        {contributions.map(c => (
          <div key={c.name} className="flex items-center gap-4">
            <div className="w-32 font-medium">{c.name}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2">
                {/* Score bar */}
                <div className="flex-1 bg-gray-200 rounded-full h-6">
                  <div
                    className="bg-blue-600 h-6 rounded-full"
                    style={{ width: `${(c.score / 10) * 100}%` }}
                  />
                </div>
                <div className="w-12 text-right">{c.score.toFixed(1)}</div>
              </div>
            </div>
            <div className="w-24 text-right text-sm text-muted-foreground">
              ×{c.weight.toFixed(2)} = {c.contribution.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between border-t pt-2">
        <div className="font-semibold">Weighted Total</div>
        <div className="text-2xl font-bold">
          {contributions.reduce((sum, c) => sum + c.contribution, 0).toFixed(2)}
        </div>
      </div>
    </div>
  )
}
```

#### Task 2.2: CLI Breakdown Display [1h]

**Update:** `apps/cli/src/formatters/text.ts`

```typescript
function formatBreakdown(result: AuditResult): string {
  const { overallScore, agents } = result

  let output = chalk.bold('\n📊 Score Breakdown\n\n')

  agents.forEach(agent => {
    const contribution = agent.score * agent.weight
    const bar = '█'.repeat(Math.round(agent.score)) + '░'.repeat(10 - Math.round(agent.score))

    output += `  ${agent.name.padEnd(20)} ${bar} ${agent.score.toFixed(1)}/10 `
    output += chalk.dim(`(×${agent.weight.toFixed(2)} = ${contribution.toFixed(2)})`)
    output += '\n'
  })

  const total = agents.reduce((sum, a) => sum + a.score * a.weight, 0)
  output += chalk.bold(`\n  Overall Score: ${overallScore.toFixed(1)}/10`)
  output += chalk.dim(` (weighted sum: ${total.toFixed(2)})`)

  return output
}
```

#### Task 2.3: Export Breakdown Data [30min-1h]

**Update:** `apps/cli/src/formatters/json.ts`

```typescript
export function formatJSON(result: AuditResult): string {
  return JSON.stringify({
    timestamp: result.timestamp,
    overallScore: result.overallScore,
    profile: result.profile,
    breakdown: result.agents.map(agent => ({
      name: agent.name,
      score: agent.score,
      weight: agent.weight,
      contribution: agent.score * agent.weight,
      findings: agent.findings.length,
    })),
    formula: generateFormula(result),
  }, null, 2)
}

function generateFormula(result: AuditResult): string {
  return result.agents
    .map(a => `(${a.name} × ${a.weight.toFixed(2)})`)
    .join(' + ')
}
```

---

### Wave 3: Quality Trend Tracking [4-6h]

#### Task 3.1: Historical Audit Storage [2h]

**Update:** Database schema

```prisma
// apps/web/prisma/schema.prisma

model Audit {
  // ... existing fields

  // Add breakdown data
  breakdown Json // Store per-agent scores and weights
  profile   String @default("balanced")
  gitRef    String? // Git commit SHA for comparison

  // ... existing relations
}
```

**Update:** API to save breakdown

```typescript
// apps/web/app/api/cli/audit/route.ts

export async function POST(req: Request) {
  // ... existing auth and validation

  const audit = await db.audit.create({
    data: {
      teamId: apiKey.teamId,
      overallScore: body.overallScore,
      breakdown: body.breakdown, // NEW: Store per-agent data
      profile: body.profile || 'balanced',
      gitRef: body.gitRef, // NEW: Git ref for comparison
      findings: {
        create: body.findings,
      },
    },
  })

  return json(audit)
}
```

#### Task 3.2: Trend Charts [2-3h]

**Create:** `apps/web/components/trend-chart.tsx`

```typescript
'use client'

import { Line } from 'react-chartjs-2'
import { useState } from 'react'

interface TrendChartProps {
  audits: Audit[]
}

export function TrendChart({ audits }: TrendChartProps) {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d')

  // Filter audits by time range
  const filteredAudits = filterByTimeRange(audits, timeRange)

  // Prepare chart data
  const chartData = {
    labels: filteredAudits.map(a => format(a.createdAt, 'MMM d')),
    datasets: [
      {
        label: 'Overall Score',
        data: filteredAudits.map(a => a.overallScore),
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
      },
    ],
  }

  const options = {
    responsive: true,
    scales: {
      y: {
        min: 0,
        max: 10,
        ticks: { stepSize: 1 },
      },
    },
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h3>Quality Trend</h3>
        <TimeRangeSelector value={timeRange} onChange={setTimeRange} />
      </div>

      <Line data={chartData} options={options} />

      {/* Regression alerts */}
      <RegressionAlerts audits={filteredAudits} />
    </div>
  )
}

function RegressionAlerts({ audits }: { audits: Audit[] }) {
  // Find audits where score dropped >1 point
  const regressions = audits.filter((audit, i) => {
    if (i === 0) return false
    const prevScore = audits[i - 1].overallScore
    return audit.overallScore < prevScore - 1.0
  })

  if (regressions.length === 0) return null

  return (
    <div className="mt-4 p-4 bg-red-50 rounded-lg">
      <h4 className="text-red-800 font-semibold">⚠️ Regressions Detected</h4>
      <ul className="mt-2 space-y-1">
        {regressions.map(audit => (
          <li key={audit.id} className="text-sm text-red-700">
            {format(audit.createdAt, 'MMM d, HH:mm')} - Score dropped to {audit.overallScore.toFixed(1)}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

#### Task 3.3: Per-Agent Trend Tracking [1h]

**Create:** Multi-line chart showing all agents

```typescript
export function DetailedTrendChart({ audits }: TrendChartProps) {
  const chartData = {
    labels: audits.map(a => format(a.createdAt, 'MMM d')),
    datasets: [
      {
        label: 'Correctness',
        data: audits.map(a => a.breakdown.correctness.score),
        borderColor: 'rgb(239, 68, 68)',
      },
      {
        label: 'Security',
        data: audits.map(a => a.breakdown.security.score),
        borderColor: 'rgb(249, 115, 22)',
      },
      {
        label: 'Performance',
        data: audits.map(a => a.breakdown.performance.score),
        borderColor: 'rgb(34, 197, 94)',
      },
      // ... other agents
    ],
  }

  return <Line data={chartData} options={options} />
}
```

---

### Wave 4: Comparison Views [4-5h]

#### Task 4.1: CLI Comparison Mode [2-3h]

**Update:** `apps/cli/src/cli.ts`

```typescript
program
  .command('audit')
  .option('--compare <ref>', 'Compare against git ref (e.g., main, HEAD~1)')
  .action(async (path, options) => {
    if (options.compare) {
      // Run audit on current code
      const currentResult = await runAudit(files, options)

      // Checkout comparison ref
      execSync(`git stash`)
      execSync(`git checkout ${options.compare}`)

      // Run audit on comparison ref
      const compareResult = await runAudit(files, options)

      // Restore current state
      execSync(`git checkout -`)
      execSync(`git stash pop`)

      // Display comparison
      displayComparison(currentResult, compareResult)
    } else {
      // Normal audit
      const result = await runAudit(files, options)
      displayResult(result)
    }
  })
```

**Create:** `apps/cli/src/formatters/comparison.ts`

```typescript
export function displayComparison(
  current: AuditResult,
  compare: AuditResult
): void {
  console.log(chalk.bold('\n📊 Comparison Results\n'))

  // Overall score delta
  const delta = current.overallScore - compare.overallScore
  const deltaColor = delta >= 0 ? chalk.green : chalk.red
  const deltaSign = delta >= 0 ? '+' : ''

  console.log(`Overall Score: ${current.overallScore.toFixed(1)}/10 `)
  console.log(deltaColor(`  ${deltaSign}${delta.toFixed(1)} vs ${compare.overallScore.toFixed(1)}`))
  console.log()

  // Per-agent comparison
  console.log(chalk.bold('Agent Scores:'))
  current.agents.forEach((agent, i) => {
    const compareAgent = compare.agents[i]
    const agentDelta = agent.score - compareAgent.score
    const deltaColor = agentDelta >= 0 ? chalk.green : chalk.red
    const deltaSign = agentDelta >= 0 ? '+' : ''

    console.log(`  ${agent.name.padEnd(20)} ${agent.score.toFixed(1)}/10 `)
    console.log(`    ${deltaColor(`${deltaSign}${agentDelta.toFixed(1)} vs ${compareAgent.score.toFixed(1)}`)}`)
  })

  // New vs resolved findings
  const newFindings = findNewFindings(current, compare)
  const resolvedFindings = findResolvedFindings(current, compare)

  console.log(chalk.bold('\n🆕 New Findings:'), newFindings.length)
  newFindings.slice(0, 5).forEach(f => console.log(`  - ${f.message}`))

  console.log(chalk.bold('\n✅ Resolved Findings:'), resolvedFindings.length)
  resolvedFindings.slice(0, 5).forEach(f => console.log(`  - ${f.message}`))
}

function findNewFindings(current: AuditResult, compare: AuditResult): Finding[] {
  const compareFingerprints = new Set(
    compare.agents.flatMap(a => a.findings).map(f => f.fingerprint)
  )

  return current.agents
    .flatMap(a => a.findings)
    .filter(f => !compareFingerprints.has(f.fingerprint))
}

function findResolvedFindings(current: AuditResult, compare: AuditResult): Finding[] {
  const currentFingerprints = new Set(
    current.agents.flatMap(a => a.findings).map(f => f.fingerprint)
  )

  return compare.agents
    .flatMap(a => a.findings)
    .filter(f => !currentFingerprints.has(f.fingerprint))
}
```

**Note:** Finding fingerprints must be stable (hash of file path + line + message)

#### Task 4.2: Dashboard PR Comparison View [2h]

**Create:** `apps/web/app/dashboard/audits/[id]/compare/page.tsx`

```typescript
interface ComparePageProps {
  params: { id: string }
  searchParams: { baseId?: string }
}

export default async function ComparePage({ params, searchParams }: ComparePageProps) {
  const currentAudit = await db.audit.findUnique({ where: { id: params.id } })
  const baseAudit = searchParams.baseId
    ? await db.audit.findUnique({ where: { id: searchParams.baseId } })
    : await findBaselineAudit(currentAudit) // Find most recent audit on main branch

  return (
    <div>
      <h1>Audit Comparison</h1>

      {/* Score delta cards */}
      <div className="grid grid-cols-2 gap-4">
        <AuditCard audit={baseAudit} label="Base (main branch)" />
        <AuditCard audit={currentAudit} label="Current (PR)" />
      </div>

      {/* Delta visualization */}
      <ScoreDelta current={currentAudit} base={baseAudit} />

      {/* Finding diff */}
      <FindingDiff current={currentAudit} base={baseAudit} />
    </div>
  )
}
```

#### Task 4.3: Changed Files Filter [30min-1h]

**Update:** Comparison views to show only changed files

```typescript
export async function getChangedFiles(baseRef: string, headRef: string): Promise<string[]> {
  const output = execSync(`git diff --name-only ${baseRef}..${headRef}`).toString()
  return output.split('\n').filter(Boolean)
}

export function filterFindingsByChangedFiles(
  findings: Finding[],
  changedFiles: string[]
): Finding[] {
  const changedSet = new Set(changedFiles)
  return findings.filter(f => changedSet.has(f.file))
}
```

---

### Wave 5: Configuration Wizard [2-3h]

#### Task 5.1: Interactive Init Command [2h]

**Create:** `apps/cli/src/commands/init.ts`

```typescript
import inquirer from 'inquirer'

export async function initCommand() {
  console.log(chalk.bold('🔧 Code Audit Configuration Wizard\n'))

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'language',
      message: 'What is your primary programming language?',
      choices: ['TypeScript', 'JavaScript', 'Python', 'Go', 'Java', 'Other'],
    },
    {
      type: 'list',
      name: 'framework',
      message: 'What framework are you using?',
      choices: ['React', 'Vue', 'Angular', 'Next.js', 'Express', 'Django', 'None'],
    },
    {
      type: 'list',
      name: 'priority',
      message: 'What is your top priority?',
      choices: [
        { name: 'Security (prevent vulnerabilities)', value: 'security' },
        { name: 'Performance (optimize speed)', value: 'performance' },
        { name: 'Correctness (find bugs)', value: 'correctness' },
        { name: 'Balanced (all dimensions)', value: 'balanced' },
      ],
    },
    {
      type: 'confirm',
      name: 'accessibility',
      message: 'Do you need accessibility (WCAG) checks?',
      default: false,
    },
    {
      type: 'confirm',
      name: 'setupApi',
      message: 'Do you want to sync results to the dashboard?',
      default: false,
    },
  ])

  // Generate config based on answers
  const config = generateConfig(answers)

  // Write .code-audit.json
  await fs.writeFile('.code-audit.json', JSON.stringify(config, null, 2))

  console.log(chalk.green('\n✅ Configuration saved to .code-audit.json'))

  // Optional: API key setup
  if (answers.setupApi) {
    await setupApiKey()
  }

  console.log(chalk.bold('\n🚀 Ready to run: code-audit .'))
}

function generateConfig(answers: any): any {
  const profileMap = {
    security: 'security-focused',
    performance: 'performance-critical',
    correctness: 'move-fast',
    balanced: 'balanced',
  }

  return {
    profile: profileMap[answers.priority],
    exclude: ['node_modules', 'dist', 'build', '.next'],
    agents: {
      accessibility: { enabled: answers.accessibility },
    },
    output: {
      format: 'text',
      verbosity: 'normal',
    },
  }
}
```

#### Task 5.2: API Key Setup Flow [1h]

**Create:** `apps/cli/src/auth.ts`

```typescript
export async function setupApiKey() {
  console.log(chalk.bold('\n🔑 Dashboard Setup\n'))

  const { method } = await inquirer.prompt([
    {
      type: 'list',
      name: 'method',
      message: 'How would you like to authenticate?',
      choices: [
        { name: 'Login via browser (OAuth)', value: 'browser' },
        { name: 'Enter API key manually', value: 'manual' },
        { name: 'Skip for now', value: 'skip' },
      ],
    },
  ])

  if (method === 'skip') return

  if (method === 'browser') {
    // Open browser to OAuth flow
    const loginUrl = 'https://code-auditor.com/cli/login'
    console.log(chalk.blue(`Opening browser: ${loginUrl}`))
    execSync(`open ${loginUrl}`)

    // Wait for callback
    const { token } = await waitForOAuthCallback()
    await saveCredentials(token)
  } else if (method === 'manual') {
    const { apiKey } = await inquirer.prompt([
      {
        type: 'password',
        name: 'apiKey',
        message: 'Enter your API key:',
      },
    ])

    await saveCredentials(apiKey)
  }

  console.log(chalk.green('✅ Authenticated successfully'))
}
```

---

## Testing Strategy

### Unit Tests

**packages/core:**
- Profile weight validation
- Orchestrator with custom profiles
- Score calculation with different weights

**apps/cli:**
- Config wizard generates correct output
- Comparison mode finds new/resolved findings
- Breakdown display formatting

**apps/web:**
- Profile CRUD operations
- Trend chart data transformation
- Comparison view calculations

### Integration Tests

**E2E flow:**
1. Run `code-audit init` → generates config
2. Edit config to use custom profile
3. Run audit → applies custom weights
4. Check breakdown matches formula
5. Run comparison → shows deltas correctly

**Dashboard flow:**
1. Create custom profile via UI
2. Run audit with custom profile
3. View trend chart (7d, 30d, 90d)
4. Compare two audits
5. Export breakdown as JSON

### Manual Testing

- [ ] All 4 builtin profiles produce different scores
- [ ] Custom profile with invalid weights is rejected
- [ ] Trend chart shows historical data correctly
- [ ] Comparison view highlights new/resolved findings
- [ ] Init wizard generates valid config
- [ ] Config wizard recommends appropriate profile

---

## Rollout Plan

### Phase 1: Backend Infrastructure (Week 1, Days 1-3)
- [ ] Define profile schema (Task 1.1)
- [ ] Update orchestrator (Task 1.2)
- [ ] Database migrations (Task 3.1)
- [ ] API endpoints for profiles (Task 1.4)

### Phase 2: CLI Features (Week 1, Days 4-5)
- [ ] CLI profile support (Task 1.3)
- [ ] Score breakdown display (Task 2.2)
- [ ] Comparison mode (Task 4.1)
- [ ] Init wizard (Task 5.1)

### Phase 3: Dashboard UI (Week 2, Days 1-3)
- [ ] Profile management page (Task 1.4)
- [ ] Score breakdown component (Task 2.1)
- [ ] Trend charts (Task 3.2, 3.3)
- [ ] Comparison view (Task 4.2)

### Phase 4: Polish & Testing (Week 2, Days 4-5)
- [ ] E2E tests for all features
- [ ] Documentation updates
- [ ] User guide for custom profiles
- [ ] Video tutorial for init wizard

---

## Success Metrics

**Adoption:**
- 60%+ of users customize at least one weight
- 30%+ use comparison mode on PRs
- 80%+ use init wizard (vs manual config)

**Quality:**
- Zero complaints about confusing scoring
- Positive feedback on trend tracking
- Comparison mode catches regressions

**Technical:**
- Profile validation never fails in production
- Trend charts load in <500ms
- Comparison mode completes in <10s

---

## Definition of Done

**Wave 1: Custom Weight Profiles**
- [ ] 4 builtin profiles implemented and tested
- [ ] Custom profile creation via config file
- [ ] Dashboard profile management UI
- [ ] CLI `--profile` and `--list-profiles` flags working
- [ ] All profiles validate (sum to 1.0)

**Wave 2: Score Breakdown**
- [ ] Breakdown component shows formula
- [ ] Visual bars for each agent contribution
- [ ] CLI displays breakdown in text format
- [ ] JSON export includes breakdown data

**Wave 3: Quality Trends**
- [ ] Historical audits stored with breakdown
- [ ] Trend chart shows 7d/30d/90d/all time
- [ ] Regression alerts for score drops >1 point
- [ ] Per-agent trend tracking

**Wave 4: Comparison Views**
- [ ] CLI `--compare` flag works with git refs
- [ ] Dashboard comparison view shows deltas
- [ ] New/resolved findings highlighted
- [ ] Changed files filter works

**Wave 5: Configuration Wizard**
- [ ] `code-audit init` command implemented
- [ ] Interactive prompts for language/framework/priority
- [ ] Generates valid `.code-audit.json`
- [ ] Optional API key setup flow

**Documentation:**
- [ ] README updated with profile examples
- [ ] User guide for customization
- [ ] Video tutorial for init wizard
- [ ] API docs for custom profiles

**Testing:**
- [ ] All unit tests pass (coverage ≥80%)
- [ ] E2E tests for all features
- [ ] Manual testing checklist complete
- [ ] No regressions in existing features

---

## Follow-up Work

**After this plan:**
- PLAN-15: Social Proof & Launch (leverages trend tracking for case studies)
- Advanced profile features (ML-suggested weights based on codebase)
- Team profile templates (share within organization)
- Profile marketplace (community-contributed profiles)
