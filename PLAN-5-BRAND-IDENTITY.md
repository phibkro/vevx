# Implementation Plan: Brand Identity & Positioning

**Priority:** 🟡 HIGH - Critical for market differentiation
**Estimated Time:** 30-40 hours over 90 days
**Owner:** Brand/Design
**Branch:** `feature/brand-identity`

## Overview

Establish a distinctive, memorable brand that communicates trust, speed, and intelligence - building recognition in the developer tools market.

**Current Problems:**
- Generic name ("AI Code Auditor" - descriptive but forgettable)
- No visual identity (colors, logo, typography)
- Inconsistent voice across surfaces (technical jargon vs friendly)
- Landing page feels like every other dev tool

**Target State:**
- Distinctive name (consider rebrand)
- Recognizable visual system (colors, logo, iconography)
- Consistent voice and tone (confident, helpful, technical-but-human)
- Memorable brand personality that stands out in screenshots

---

## Strategic Decision: Rebrand or Keep Current Name?

### Current Name Analysis

**"AI Code Auditor"**

**Pros:**
- ✅ Descriptive (immediately clear what it does)
- ✅ SEO-friendly (ranks for "AI code auditor" searches)
- ✅ Professional/credible
- ✅ No trademark conflicts

**Cons:**
- ❌ Generic (sounds like 100 other AI tools)
- ❌ Long (6 syllables - hard to say quickly)
- ❌ No personality (feels corporate)
- ❌ "Auditor" has negative connotations (IRS, compliance, boring)

**Competitive landscape:**
- SonarQube (distinctive, memorable)
- Codacy (short, modern)
- DeepSource (evocative, conveys depth)
- Snyk (ultra-short, unique)
- **AI Code Auditor** (descriptive but forgettable)

---

### Rebrand Option: "Ship"

**Why "Ship":**
- 1 syllable (easy to say, remember, type)
- Developer culture term ("ship it" = deploy to production)
- Positive emotional association (excitement, forward momentum)
- Implies confidence ("ship with confidence")
- Available domain: ship.dev, getship.com, shipcode.com
- Memorable in conversation: "Did you Ship it?" (double meaning)

**Brand positioning:**
- Tagline: "Ship with confidence"
- Subtext: "AI code review in 30 seconds"
- Personality: Fast, confident, empowering

**Messaging shift:**
```
Before: "AI Code Auditor - Multi-agent code quality auditor"
After:  "Ship - Catch bugs AI coding assistants miss"
```

**Product names:**
- CLI: `ship` (vs `code-auditor`)
- GitHub Action: `ship-action` (vs `ai-code-auditor/action`)
- Web app: ship.dev

**Usage:**
```bash
# Before
code-auditor login
code-auditor .

# After
ship login
ship .  # or just "ship"
```

**Pro/Con:**

**Pros:**
- 🚀 Ultra-memorable (1 syllable, common word, strong verb)
- 🎯 Aligns with target emotion (confidence to deploy)
- ⚡ Fast to type/say (critical for CLI tools)
- 💪 Strong brand personality (not generic)
- 🌊 Room to expand (Ship = whole deployment confidence platform)

**Cons:**
- 🔍 SEO reset (lose "AI Code Auditor" keyword rankings)
- 📝 Confusing at first (doesn't describe what it does - need tagline)
- ⚠️ Risky (rebrand during launch = confusion)
- 💰 Cost (new domain, reprint materials, redesign)

---

### Decision Framework

**Keep "AI Code Auditor" if:**
- Launching in <30 days (rebrand adds complexity)
- Budget-constrained (<$1K for rebrand)
- SEO is primary acquisition channel
- Risk-averse (rebrand can confuse early users)

**Rebrand to "Ship" if:**
- Have 60-90 days before major launch
- Want strong brand differentiation
- Willing to invest in brand ($2-5K design budget)
- Optimizing for word-of-mouth (memorable name spreads faster)

---

### Recommended Approach: **Phased Rebrand**

**Phase 1 (Month 1-2): Launch as "AI Code Auditor"**
- Focus on product-market fit, not brand
- Test messaging with current name
- Build initial customer base

**Phase 2 (Month 3): Soft rebrand to "Ship by AI Code Auditor"**
- Introduce "Ship" as shorthand
- CLI command becomes `ship` (alias to `code-auditor`)
- Update tagline to "Ship with confidence"
- Test market reception

**Phase 3 (Month 4-6): Full rebrand to "Ship"**
- Once revenue > $2K MRR (justifies rebrand cost)
- Migrate domain, redesign site
- Announce rebrand to existing users
- Full visual identity rollout

**Benefits:**
- ✅ Launch quickly with current name
- ✅ Test "Ship" positioning before committing
- ✅ Rebrand when you have traction (lower risk)
- ✅ Spread cost over time

**Implementation for this plan:** Design both identities in parallel, decide at Month 3 milestone.

---

## Task 1: Visual Identity System (Week 1-2, 16 hours)

### Color Palette

**Strategy:** Stand out from competitors (most use blue/purple), convey trust + speed

**Competitor analysis:**
- SonarQube: Red/white (bold, security-focused)
- Codacy: Green/dark (growth, stability)
- DeepSource: Purple/black (premium, technical)
- Snyk: Purple (security, trust)

**Option A: Speed-focused (Orange/Black)**
```css
:root {
  /* Primary */
  --brand-orange: #FF6B35;     /* High energy, fast action */
  --brand-black: #0A0A0A;      /* Confidence, professionalism */

  /* Secondary */
  --accent-yellow: #FFB84D;    /* Warnings, highlights */
  --accent-teal: #00C9A7;      /* Success, positive signals */

  /* Neutrals */
  --gray-50: #F9FAFB;
  --gray-100: #F3F4F6;
  --gray-900: #111827;

  /* Semantic */
  --critical: #EF4444;   /* Red - critical issues */
  --warning: #F59E0B;    /* Amber - warnings */
  --info: #3B82F6;       /* Blue - info */
  --success: #10B981;    /* Green - success */
}
```

**Rationale:**
- Orange = speed, energy (differentiates from blue/purple tools)
- Black = confidence, premium feel
- High contrast = accessible, readable in terminals

---

**Option B: Trust-focused (Blue/Green)**
```css
:root {
  /* Primary */
  --brand-blue: #0066FF;       /* Trust, intelligence */
  --brand-green: #00D9A3;      /* Security, success */

  /* Secondary */
  --accent-purple: #7C3AED;    /* AI, advanced tech */
  --accent-cyan: #06B6D4;      /* Data, analysis */

  /* Neutrals */
  --gray-50: #F9FAFB;
  --gray-900: #0F172A;

  /* Semantic (same as Option A) */
}
```

**Rationale:**
- Blue = trust, reliability (safer choice)
- Green = security, correctness
- Gradient blue→green suggests quality improvement

---

**Recommended: Option A (Orange/Black)** for differentiation

**Usage:**
```typescript
// tailwind.config.ts
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          orange: '#FF6B35',
          black: '#0A0A0A',
        },
        accent: {
          yellow: '#FFB84D',
          teal: '#00C9A7',
        },
      },
    },
  },
};
```

**Apply to:**
- [ ] Landing page (primary CTA buttons = orange)
- [ ] Dashboard (accent for positive trends)
- [ ] Terminal output (orange for brand, black for text)
- [ ] GitHub Action PR comments (orange headers)

---

### Logo Concepts

**Design brief:**
- Style: Modern, minimal, technical
- Must work in: 16x16px favicon, 512x512px social, terminal ASCII
- Convey: Speed, intelligence, code quality

**Concept 1: Checkmark Shield**
```
   ╱▔▔▔╲
  ╱  ✓  ╲
 ╱   │   ╲
╱____│____╲
```
- Meaning: Protection (shield) + correctness (checkmark)
- Works in: Emoji ✅, terminal, small sizes
- Personality: Trustworthy, defensive

**Concept 2: Lightning Code Bracket**
```
{⚡}
```
- Meaning: Code (brackets) + speed (lightning)
- Works in: Emoji, Unicode, small sizes
- Personality: Fast, energetic, modern

**Concept 3: Five Dots (Multi-Agent)**
```
┌─┬─┐
│●│●│
├─┼─┤
│●│●│
└─┴─┘
  ●
```
- Meaning: 5 agents (5 dots) analyzing code (grid)
- Works in: Terminal, small sizes
- Personality: Intelligent, systematic

**Recommended: Concept 2 (Lightning Code)** - memorable, conveys speed

**File deliverables:**
```
brand/
├── logo/
│   ├── lightning-code.svg          # Full color vector
│   ├── lightning-code-mono.svg     # Black only (for print)
│   ├── lightning-code-white.svg    # White only (for dark bg)
│   ├── favicon.ico                 # 16x16, 32x32, 64x64
│   └── social-preview.png          # 1200x630 (Twitter/OG)
└── ascii/
    └── terminal-logo.txt           # ASCII art for CLI
```

**ASCII logo for CLI:**
```
   _____ __    _____
  / ___// /_  /  _/ /_
  \__ \/ __ \ / // __/
 ___/ / / / // // /_
/____/_/ /_/___/\__/

Ship with confidence
```

**Acceptance Criteria:**
- [ ] Color palette defined in CSS variables
- [ ] Logo in 5 formats (SVG, PNG, ICO, ASCII)
- [ ] Works at all sizes (16px - 512px)
- [ ] Tested on light + dark backgrounds

---

### Typography

**Goals:**
- Code-friendly (monospace for CLI/terminal)
- Modern but not trendy (won't age poorly)
- Accessible (high contrast, readable at small sizes)

**System:**

**Display/Headings:** Inter (sans-serif)
- Clean, modern, widely supported
- Good at large sizes (landing page hero)
- Free, open-source (Google Fonts)

**Body text:** Inter (same as headings for consistency)

**Code/Terminal:** JetBrains Mono
- Designed for developers
- Excellent readability in CLI
- Ligatures for code (optional)

**Implementation:**
```css
/* app/globals.css */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

:root {
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-mono: 'JetBrains Mono', 'Monaco', 'Courier New', monospace;
}

body {
  font-family: var(--font-sans);
}

code, pre {
  font-family: var(--font-mono);
}
```

**Type scale:**
```css
:root {
  /* Desktop */
  --text-xs: 0.75rem;    /* 12px - labels */
  --text-sm: 0.875rem;   /* 14px - body small */
  --text-base: 1rem;     /* 16px - body */
  --text-lg: 1.125rem;   /* 18px - emphasis */
  --text-xl: 1.25rem;    /* 20px - section headers */
  --text-2xl: 1.5rem;    /* 24px - page headers */
  --text-3xl: 1.875rem;  /* 30px - hero subheading */
  --text-4xl: 2.25rem;   /* 36px - hero heading */

  /* Line heights */
  --leading-tight: 1.25;
  --leading-normal: 1.5;
  --leading-relaxed: 1.75;
}
```

**Acceptance Criteria:**
- [ ] Fonts loaded from Google Fonts (or self-hosted)
- [ ] Type scale defined in CSS
- [ ] Applied consistently across web + docs

---

### Iconography

**Style:** Outlined (not filled) for modern, approachable feel

**Icon set:** Heroicons (matches Inter typography, free)

**Custom icons needed:**
```
5 Agent icons:
- Correctness: target / bullseye
- Security: shield-check
- Performance: lightning-bolt
- Maintainability: wrench / cog
- Edge Cases: beaker / flask (testing)

Status icons:
- Critical: exclamation-circle (red)
- Warning: exclamation-triangle (yellow)
- Info: information-circle (blue)
- Success: check-circle (green)

Action icons:
- Audit: play-circle
- Export: download
- Share: share
- Settings: cog
```

**Implementation:**
```typescript
// components/icons/index.tsx
import {
  ShieldCheckIcon,
  BoltIcon,
  BeakerIcon,
  // ... other icons
} from '@heroicons/react/24/outline';

export const AgentIcon = {
  correctness: TargetIcon,
  security: ShieldCheckIcon,
  performance: BoltIcon,
  maintainability: WrenchIcon,
  'edge-cases': BeakerIcon,
};
```

**Acceptance Criteria:**
- [ ] Icon library added (Heroicons)
- [ ] Custom agent icons mapped
- [ ] Consistent 24px size across UI
- [ ] Accessible (aria-labels, proper semantics)

---

## Task 2: Voice & Tone Guidelines (Week 3, 8 hours)

### Brand Personality

**If the brand were a person:**
- **Role:** Senior engineer who mentors juniors (helpful, confident, not condescending)
- **Personality:** Fast-talking but clear, enthusiastic about good code, friendly but professional
- **NOT:** Corporate suit, academic lecturer, snarky hacker

**Attributes:**
1. **Confident** - We know what we're doing (but not arrogant)
2. **Helpful** - Here to make your life easier (not judge you)
3. **Technical** - Speaks developer language (but avoids jargon)
4. **Fast** - Values your time (concise, no fluff)

---

### Voice Guidelines

**Writing principles:**

**1. Use active voice**
```
❌ "Issues were found in your code"
✅ "We found 3 security issues"
```

**2. Be specific, not vague**
```
❌ "There might be some problems"
✅ "SQL injection risk on line 47"
```

**3. Avoid passive-aggressive**
```
❌ "You should probably fix this..."
✅ "Fix this to prevent data leaks"
```

**4. Explain the "why", not just "what"**
```
❌ "Avoid using innerHTML"
✅ "Avoid innerHTML - opens XSS vulnerability"
```

**5. Use "we/our" not "the system"**
```
❌ "The system has analyzed your code"
✅ "We analyzed your code with 5 AI specialists"
```

---

### Tone by Context

**Landing page: Confident + Aspirational**
```
Headline: "Ship with confidence"
Subhead: "Catch bugs AI coding assistants miss. Five specialists review your code in 30 seconds."

CTA: "Start auditing" (not "Sign up" or "Try for free")
```

**Error messages: Helpful + Specific**
```
❌ "Authentication failed"
✅ "API key not found. Add it to your .env file:
   AUDITOR_API_KEY=ca_your_key_here"

❌ "Invalid input"
✅ "This file is too large (5MB). Try auditing a smaller file or directory."
```

**Audit reports: Direct + Actionable**
```
❌ "Potential null reference exception detected"
✅ "Null pointer risk on line 23
   → Add null check before user.email.toLowerCase()"

❌ "Consider refactoring for better maintainability"
✅ "High complexity (score: 28)
   → Extract 'validatePayment' into separate function"
```

**Marketing emails: Conversational + Valuable**
```
Subject: "You caught 5 bugs this week 🎉"

Body:
"Hi Alex,

Quick stats from your audits this week:

🔴 2 critical issues (both security flaws)
⚠️  3 warnings (N+1 query, unused variables)
✅ Average code quality: 7.8/10 (up from 7.2 last week!)

Your code is getting better. Keep shipping.

- [Founder name]

P.S. Want to see quality trends over time? Upgrade to Team for the dashboard."
```

**Documentation: Clear + Concise**
```
# Quick Start

1. Install:
   curl -fsSL https://get.code-auditor.com | sh

2. Login:
   ship login

3. Audit your code:
   ship .

You'll see a report in ~30 seconds.
```

---

### Writing Checklist

Before publishing any copy, check:
- [ ] Is it concise? (Cut 30% of words)
- [ ] Is it specific? (No vague claims)
- [ ] Is it helpful? (Clear next step)
- [ ] Does it sound human? (Read aloud test)
- [ ] Is the tone appropriate for context?

**Acceptance Criteria:**
- [ ] Voice & tone doc written (markdown)
- [ ] Examples for each context (landing, errors, emails, docs)
- [ ] Reviewed by team
- [ ] Applied to existing copy

---

## Task 3: Landing Page Redesign (Week 4-6, 12 hours)

### Current Problems
- Looks like every other AI tool (gradient header, generic layout)
- No personality (feels corporate, not scrappy startup)
- Buried value proposition (technical jargon upfront)

### New Approach: **Bold, Simple, Fast**

**Design principles:**
1. **High contrast** - Black text on white, orange accents (readable, confident)
2. **Asymmetric layout** - Not centered (dynamic, modern)
3. **Real screenshots** - No stock photos (authentic, trustworthy)
4. **Big type** - 48px+ headlines (impossible to miss)
5. **Minimal animation** - Subtle fades only (fast load, accessible)

---

### Redesigned Hero Section

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  [Logo]                      [Docs] [Pricing] [Sign In] │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  Ship with confidence                   ┌──────────────┐│
│  ================================        │              ││
│                                          │  [Terminal   ││
│  Catch bugs AI coding assistants miss.  │   screenshot ││
│  Five specialists review your code in   │   showing    ││
│  30 seconds.                             │   audit      ││
│                                          │   report]    ││
│  • Security flaws                        │              ││
│  • Performance issues                    └──────────────┘│
│  • Logic errors                                          │
│                                                          │
│  [Start Auditing →]  [See example report]               │
│  ↑ orange button      ↑ text link                       │
│                                                          │
│  "Caught 3 security bugs we would have shipped"         │
│  - Alex Chen, CTO @ StartupX                            │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

**Code:**
```tsx
// app/page.tsx

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="max-w-7xl mx-auto px-6 py-24">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Copy */}
          <div>
            <h1 className="text-6xl font-bold tracking-tight text-gray-900 mb-6">
              Ship with confidence
            </h1>

            <p className="text-xl text-gray-600 mb-4">
              Catch bugs AI coding assistants miss. Five specialists review your code in 30 seconds.
            </p>

            <ul className="text-lg text-gray-700 space-y-2 mb-8">
              <li>• Security flaws</li>
              <li>• Performance issues</li>
              <li>• Logic errors</li>
            </ul>

            <div className="flex gap-4">
              <button className="bg-brand-orange text-white px-8 py-4 rounded-lg text-lg font-semibold hover:bg-orange-600 transition">
                Start Auditing →
              </button>
              <button className="text-gray-600 hover:text-gray-900 underline">
                See example report
              </button>
            </div>

            {/* Social proof */}
            <div className="mt-12 p-6 bg-gray-50 rounded-lg border-l-4 border-brand-orange">
              <p className="text-gray-700 italic mb-2">
                "Caught 3 security bugs we would have shipped"
              </p>
              <p className="text-sm text-gray-600">
                - Alex Chen, CTO @ StartupX
              </p>
            </div>
          </div>

          {/* Right: Screenshot */}
          <div className="relative">
            <div className="bg-black rounded-lg shadow-2xl p-6">
              <TerminalScreenshot />
            </div>

            {/* Floating badge */}
            <div className="absolute -top-4 -right-4 bg-accent-teal text-white px-4 py-2 rounded-full font-semibold shadow-lg">
              30 second audits ⚡
            </div>
          </div>
        </div>
      </section>

      {/* ... rest of page */}
    </div>
  );
}
```

---

### Problem Section

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  The problem with AI-generated code                      │
│  =====================================                   │
│                                                          │
│  [Stat block 1]    [Stat block 2]    [Stat block 3]    │
│  45% of devs say   AI code has       Senior engineers   │
│  debugging AI      40-62% flaw rate  spend 50% of time  │
│  code takes                           reviewing AI PRs   │
│  longer than                                             │
│  writing manually                                        │
│                                                          │
│  GitHub Copilot and Cursor write code fast. But who's   │
│  reviewing the AI code?                                  │
└─────────────────────────────────────────────────────────┘
```

---

### Solution Section

**Layout:**
```
┌─────────────────────────────────────────────────────────┐
│  Five AI specialists. One comprehensive review.          │
│  ================================================        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ [🎯 Icon]    │  │ [🔒 Icon]    │  │ [⚡ Icon]    │  │
│  │ Correctness  │  │ Security     │  │ Performance  │  │
│  │              │  │              │  │              │  │
│  │ Logic errors │  │ SQL injection│  │ N+1 queries  │  │
│  │ Type safety  │  │ XSS flaws    │  │ Memory leaks │  │
│  │ Null handling│  │ Secrets      │  │ Slow loops   │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐                    │
│  │ [🛠️ Icon]   │  │ [🔍 Icon]    │                    │
│  │ Maintain-    │  │ Edge Cases   │                    │
│  │ ability      │  │              │                    │
│  │              │  │ Boundary     │                    │
│  │ Complexity   │  │ conditions   │                    │
│  │ Code smells  │  │ Error        │                    │
│  │ DRY          │  │ handling     │                    │
│  └──────────────┘  └──────────────┘                    │
│                                                          │
│  Each agent evaluates independently. Disagreements       │
│  surface trade-offs (e.g., "fast but insecure").        │
└─────────────────────────────────────────────────────────┘
```

---

### How It Works Section

**Layout: Timeline (horizontal)**
```
┌─────────────────────────────────────────────────────────┐
│  Get results in 3 steps                                  │
│  ======================                                  │
│                                                          │
│  1 ───────→ 2 ───────→ 3                                │
│  Install    Run audit  Get report                        │
│                                                          │
│  [Terminal] [Terminal] [Dashboard                        │
│   showing]  [showing]   screenshot]                      │
│   curl cmd] [ship cmd]                                   │
│                                                          │
│  2 minutes  30 seconds  Actionable                       │
│             per audit   fixes                            │
└─────────────────────────────────────────────────────────┘
```

---

### Social Proof Section

**Layout: Testimonial cards (3 column)**
```
┌─────────────────────────────────────────────────────────┐
│  What developers are saying                              │
│  ==========================                              │
│                                                          │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐        │
│  │ "Caught    │  │ "Cut our   │  │ "Best $39  │        │
│  │ 5 N+1      │  │ PR review  │  │ we spend   │        │
│  │ queries... │  │ time by    │  │ every      │        │
│  │ response   │  │ 70%"       │  │ month"     │        │
│  │ time down  │  │            │  │            │        │
│  │ 60%"       │  │ - Sarah J. │  │ - Mike P.  │        │
│  │            │  │   CTO,     │  │   Staff    │        │
│  │ - Alex C.  │  │   FinTech  │  │   Engineer │        │
│  │   CTO,     │  │   Startup  │  │            │        │
│  │   StartupX │  │            │  │            │        │
│  └────────────┘  └────────────┘  └────────────┘        │
└─────────────────────────────────────────────────────────┘
```

---

### Pricing Section

**Layout: 3 cards (Free, Pro, Team highlighted)**
```
┌─────────────────────────────────────────────────────────┐
│  Simple, transparent pricing                             │
│  ========================                                │
│                                                          │
│  ┌─────────┐  ┌──────────────┐  ┌─────────┐            │
│  │ Free    │  │ Pro          │  │ Team    │            │
│  │         │  │ ← MOST       │  │         │            │
│  │ $0      │  │   POPULAR    │  │ $249/mo │            │
│  │         │  │              │  │         │            │
│  │ • 15    │  │ $39/mo       │  │ • 10    │            │
│  │   audits│  │              │  │   users │            │
│  │ • Public│  │ • Unlimited  │  │ • Team  │            │
│  │   repos │  │   audits     │  │   dash  │            │
│  │         │  │ • Private    │  │ • API   │            │
│  │ [Start] │  │   repos      │  │         │            │
│  │         │  │              │  │ [Start] │            │
│  │         │  │ [Start Free  │  │         │            │
│  │         │  │  Trial]      │  │         │            │
│  └─────────┘  └──────────────┘  └─────────┘            │
│                 ↑ Orange border                          │
│                   + shadow                               │
└─────────────────────────────────────────────────────────┘
```

---

### CTA Section

**Layout: Full-width colored block**
```
┌─────────────────────────────────────────────────────────┐
│  [Orange background, full width]                         │
│                                                          │
│  Ready to ship with confidence?                          │
│  ===============================                         │
│                                                          │
│  Start auditing in 2 minutes. No credit card required.  │
│                                                          │
│  [Start Free Trial]  ← white button on orange bg        │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

---

**Acceptance Criteria:**
- [ ] Landing page redesigned (all sections)
- [ ] Color palette applied consistently
- [ ] Real screenshots (not placeholder)
- [ ] 3+ testimonials collected
- [ ] Mobile responsive (test on phone)
- [ ] Load time <2 seconds (Lighthouse score >90)
- [ ] A/B tested (old vs new, winner determined)

---

## Task 4: Terminal Output Branding (Week 7, 4 hours)

### Current Output

```
Overall Score: 7.5/10

Critical Issues (2):
- SQL injection risk on line 47
- Hardcoded API key on line 12

Warnings (5):
- ...
```

**Problem:** Generic, looks like every other CLI tool

---

### Branded Output

**Add ASCII art header:**
```bash
   _____ __    _____
  / ___// /_  /  _/ /_
  \__ \/ __ \ / // __/
 ___/ / / / // // /_
/____/_/ /_/___/\__/

Ship with confidence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🎯 Auditing 47 files...

[████████████████████████████████] 100%  (30.2s)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  AUDIT REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall Score: 7.5/10  ⚠️

🔴 Critical Issues (2)
  ├─ SQL injection risk
  │  src/auth.ts:47
  │  Fix: Use parameterized query
  │
  └─ Hardcoded API key
     config.ts:12
     Fix: Move to environment variable

⚠️  Warnings (5)
  ├─ N+1 query detected
  │  src/users.ts:23
  │
  ├─ High complexity (score: 28)
  │  src/payment.ts:45
  │  Fix: Extract to separate function
  │
  └─ ... (3 more)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 Top Recommendations:
  1. Fix SQL injection (CRITICAL)
  2. Remove hardcoded secrets (CRITICAL)
  3. Optimize user query (70% faster)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

View in dashboard: https://ship.dev/audits/abc123

Powered by Ship • ship.dev
```

**Implementation:**
```typescript
// src/report/terminal.ts

import chalk from 'chalk';

const LOGO = `
   _____ __    _____
  / ___// /_  /  _/ /_
  \__ \/ __ \ / // __/
 ___/ / / / // // /_
/____/_/ /_/___/\__/
`;

const DIVIDER = '━'.repeat(60);

export function renderReport(report: AuditReport) {
  console.log(chalk.hex('#FF6B35')(LOGO));  // Brand orange
  console.log(chalk.gray('Ship with confidence'));
  console.log(chalk.gray(DIVIDER));

  // ... rest of report

  // Footer
  console.log(chalk.gray(DIVIDER));
  console.log(chalk.gray('Powered by Ship • ship.dev'));
}
```

**Acceptance Criteria:**
- [ ] ASCII logo added to CLI output
- [ ] Color scheme matches brand (orange accents)
- [ ] Footer with link to dashboard
- [ ] Tested in: macOS Terminal, iTerm2, VS Code terminal, Windows Terminal

---

## Task 5: GitHub Action PR Comment Branding (Week 8, 4 hours)

### Current PR Comment

```markdown
## AI Code Auditor Report

**Overall Score:** 7.5/10

**Critical Issues:** 2
**Warnings:** 5

[See full report →](https://code-auditor.com/audits/abc123)
```

**Problem:** Looks like every other bot comment, easy to ignore

---

### Branded PR Comment

```markdown
## 🚀 Ship Code Quality Report

<div align="center">
  <img src="https://ship.dev/badge/score/7.5" alt="Score: 7.5/10" />
</div>

### 🔴 Critical Issues (2)

| File | Line | Issue | Severity |
|------|------|-------|----------|
| `src/auth.ts` | 47 | SQL injection risk | 🔴 Critical |
| `config.ts` | 12 | Hardcoded API key | 🔴 Critical |

<details>
<summary>💡 How to fix SQL injection</summary>

**Current code:**
```typescript
const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

**Fixed code:**
```typescript
const user = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
```

Use parameterized queries to prevent SQL injection.
</details>

---

### ⚠️ Warnings (5)

<details>
<summary>View all warnings</summary>

- N+1 query in `src/users.ts:23`
- High complexity in `src/payment.ts:45`
- Unused variable `temp` in `src/utils.ts:12`
- Missing error handling in `src/api.ts:67`
- Potential null reference in `src/profile.ts:89`

</details>

---

### 📊 Agent Breakdown

| Agent | Score | Status |
|-------|-------|--------|
| 🎯 Correctness | 8.5/10 | ✅ Good |
| 🔒 Security | 4.0/10 | 🔴 Critical |
| ⚡ Performance | 6.5/10 | ⚠️ Needs work |
| 🛠️ Maintainability | 7.0/10 | ✅ Good |
| 🔍 Edge Cases | 8.0/10 | ✅ Good |

---

<div align="center">

**[View full report →](https://ship.dev/audits/abc123)**

<sub>Powered by [Ship](https://ship.dev) • Catch bugs AI coding assistants miss</sub>

</div>
```

**Implementation:**
```typescript
// src/github/comment.ts

export function formatComment(report: AuditReport): string {
  let md = `## 🚀 Ship Code Quality Report\n\n`;

  // Score badge (dynamically generated SVG)
  md += `<div align="center">\n`;
  md += `  <img src="${process.env.APP_URL}/badge/score/${report.overallScore}" />\n`;
  md += `</div>\n\n`;

  // Critical issues table
  if (report.criticalCount > 0) {
    md += `### 🔴 Critical Issues (${report.criticalCount})\n\n`;
    md += `| File | Line | Issue | Severity |\n`;
    md += `|------|------|-------|----------|\n`;

    report.findings
      .filter(f => f.severity === 'critical')
      .forEach(f => {
        md += `| \`${f.file}\` | ${f.line} | ${f.title} | 🔴 Critical |\n`;
      });

    // Expandable fix suggestions
    md += `\n<details>\n<summary>💡 How to fix</summary>\n\n`;
    // ... fix details
    md += `</details>\n\n`;
  }

  // Agent breakdown
  md += `### 📊 Agent Breakdown\n\n`;
  md += `| Agent | Score | Status |\n`;
  md += `|-------|-------|--------|\n`;
  report.agentResults.forEach(a => {
    const icon = getAgentIcon(a.agent);
    const status = getStatusEmoji(a.score);
    md += `| ${icon} ${a.agent} | ${a.score}/10 | ${status} |\n`;
  });

  // Footer
  md += `\n---\n\n`;
  md += `<div align="center">\n\n`;
  md += `**[View full report →](${process.env.APP_URL}/audits/${report.id})**\n\n`;
  md += `<sub>Powered by [Ship](https://ship.dev) • Catch bugs AI coding assistants miss</sub>\n\n`;
  md += `</div>\n`;

  return md;
}
```

**Dynamic badge endpoint:**
```typescript
// web/app/api/badge/score/[score]/route.ts

export async function GET(req: Request, { params }: { params: { score: string } }) {
  const score = parseFloat(params.score);
  const color = score >= 8 ? '#00D9A3' : score >= 6 ? '#FFB84D' : '#EF4444';

  const svg = `
    <svg width="120" height="40" xmlns="http://www.w3.org/2000/svg">
      <rect width="120" height="40" fill="${color}" rx="5"/>
      <text x="60" y="25" text-anchor="middle" fill="white" font-family="Inter" font-size="16" font-weight="700">
        ${score}/10
      </text>
    </svg>
  `;

  return new Response(svg, {
    headers: { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=3600' },
  });
}
```

**Acceptance Criteria:**
- [ ] Branded PR comment format implemented
- [ ] Dynamic score badge working
- [ ] Expandable sections for long content
- [ ] Footer link to dashboard
- [ ] Tested on public PR (screenshot for marketing)

---

## 90-Day Brand Rollout Timeline

### Month 1: Foundation
**Week 1-2: Visual identity**
- [ ] Color palette finalized
- [ ] Logo designed (3 concepts → 1 final)
- [ ] Typography system defined

**Week 3: Voice & tone**
- [ ] Brand personality documented
- [ ] Writing guidelines created
- [ ] Examples for each context

**Week 4: Landing page**
- [ ] Hero section redesigned
- [ ] Social proof collected (3+ testimonials)
- [ ] A/B test launched

---

### Month 2: Application
**Week 5-6: Product branding**
- [ ] Terminal output redesigned
- [ ] GitHub Action PR comments redesigned
- [ ] Dashboard UI updated with brand colors

**Week 7: Collateral**
- [ ] Pitch deck template (for sales)
- [ ] Email templates (transactional + marketing)
- [ ] Social media assets (Twitter header, profile pic)

**Week 8: Launch prep**
- [ ] Product Hunt assets (gallery images, video)
- [ ] Blog visual identity (hero images, diagrams)
- [ ] "Powered by Ship" badge for public repos

---

### Month 3: Rebrand Decision
**Week 9-10: "Ship" soft launch**
- [ ] CLI alias `ship` available (alongside `code-auditor`)
- [ ] Test "Ship" messaging on landing page (A/B test)
- [ ] Collect user feedback on name change

**Week 11: Decide**
- [ ] Evaluate: sign-up rate, word-of-mouth mentions, user feedback
- [ ] **Decision:** Full rebrand to "Ship" OR keep "AI Code Auditor"

**Week 12: Execute**
- [ ] If rebrand: Domain migration, full site redesign, announcement
- [ ] If keep: Refine current brand, continue with existing name

---

## Implementation Checklist

**Visual Identity:**
- [ ] Color palette defined (CSS variables)
- [ ] Logo in 5 formats (SVG, PNG, ICO, ASCII)
- [ ] Typography system (Inter + JetBrains Mono)
- [ ] Icon library (Heroicons + custom agent icons)

**Voice & Tone:**
- [ ] Brand personality documented
- [ ] Writing guidelines (with examples)
- [ ] Applied to: landing, errors, emails, docs

**Landing Page:**
- [ ] Hero redesigned (bold, asymmetric)
- [ ] 5 sections (hero, problem, solution, how, pricing, CTA)
- [ ] 3+ testimonials
- [ ] Mobile responsive
- [ ] A/B tested (bounce rate improvement)

**Product Branding:**
- [ ] Terminal output with ASCII logo
- [ ] GitHub Action PR comments redesigned
- [ ] Dynamic score badges
- [ ] Dashboard UI updated

**Rebrand (Optional):**
- [ ] "Ship" tested as soft launch
- [ ] User feedback collected
- [ ] Decision documented
- [ ] Rollout plan if approved

---

**Total time:** 30-40 hours over 90 days (distributed across design, implementation, testing).

**Branch:** `feature/brand-identity`
**Merge after:** Visual identity finalized, landing page tested
