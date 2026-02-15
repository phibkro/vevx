# Implementation Plan: Positioning & Pricing Fixes

**Priority:** 🟡 HIGH - Critical for conversion
**Estimated Time:** 8-12 hours
**Owner:** Product/Marketing
**Branch:** `feature/positioning-fixes`

## Overview

Fix backwards pricing structure and reposition from technical jargon ("multi-agent") to value-based messaging that resonates with buyers.

**Current Problems:**
- Team tier ($29.80/user) is cheaper than Pro ($29/user) ❌
- "Multi-agent" is engineer-speak, not a benefit
- Target market too broad ("developers")
- Free tier either too generous or too restrictive

**Target State:**
- Proper pricing ladder (Pro → Team → Enterprise)
- Value-focused positioning ("Ship with confidence")
- Clear target: Startups with 10-50 engineers
- Optimized free tier for conversion

---

## Pricing Strategy

### Current Pricing (BROKEN)

| Plan | Price | Per User | Problem |
|------|-------|----------|---------|
| Free | $0 | - | 5 audits may be too low for trial |
| Pro | $29/mo | $29 | Solo devs won't pay this |
| Team | $149/mo (5 users) | $29.80 | **Cheaper per user than Pro!** |
| Enterprise | Custom | ? | Undefined |

**Perverse Incentive:** Why would anyone buy Pro when Team is cheaper per seat?

### Recommended Pricing

| Plan | Price | Per User | Value Prop |
|------|-------|----------|------------|
| **Free Trial** | $0 | - | 15 audits/mo, public repos only |
| **Pro** | $39/mo | $39 | Unlimited audits, private repos |
| **Team** | $249/mo (10 users) | $24.90 | Dashboard, API, team features |
| **Enterprise** | $999+/mo | Custom | SSO, compliance, on-prem |

**Pricing Ladder:**
- Free → Pro: 3.9x jump ($0 → $39)
- Pro → Team: 6.4x jump ($39 → $249)
- Team → Enterprise: 4x+ jump ($249 → $999+)

**Rationale:**
1. **Free increased to 15 audits** - 5 is too limiting for evaluation
2. **Pro increased to $39** - Positions as premium, median dev tool pricing
3. **Team repriced to $249 for 10 users** - Now properly more expensive than Pro per user initially, but becomes cheaper at scale
4. **Enterprise starts at $999** - B2B pricing, compliance value justifies 4-figure pricing

---

## Implementation Tasks

### Task 1: Update Pricing in Code (2 hours)

**Files to update:**
- `web/lib/stripe/config.ts`
- `web/app/(dashboard)/team/page.tsx`
- `README.md`
- `web/README.md`
- `GETTING-STARTED.md`

**Stripe Products:**
```typescript
// web/lib/stripe/config.ts

export const STRIPE_PRODUCTS = {
  PRO: {
    name: 'Pro',
    priceId: process.env.STRIPE_PRO_PRICE_ID!,
    amount: 3900, // $39.00
    interval: 'month',
    features: [
      'Unlimited audits',
      'Private repositories',
      '30-day audit history',
      'Markdown export',
      'Email support',
    ],
  },
  TEAM: {
    name: 'Team',
    priceId: process.env.STRIPE_TEAM_PRICE_ID!,
    amount: 24900, // $249.00
    interval: 'month',
    seats: 10,
    features: [
      'Everything in Pro, plus:',
      'Up to 10 team members',
      'Team dashboard',
      '90-day audit history',
      'Quality trend charts',
      'API access',
      'Role-based access control',
      'Priority support',
    ],
  },
  ENTERPRISE: {
    name: 'Enterprise',
    contactSales: true,
    features: [
      'Everything in Team, plus:',
      'Unlimited team members',
      'SSO / SAML',
      'Compliance reports (SOC2, ISO27001)',
      'On-premise deployment',
      'Custom integrations',
      'Dedicated support',
      'SLA guarantees',
    ],
  },
}
```

**Plan Limits:**
```typescript
// web/lib/plan-limits.ts

export const PLAN_LIMITS = {
  FREE: {
    auditsPerMonth: 15,
    teamMembers: 1,
    privateRepos: false,
    apiAccess: false,
    auditHistoryDays: 7,
  },
  PRO: {
    auditsPerMonth: Infinity, // Unlimited
    teamMembers: 1,
    privateRepos: true,
    apiAccess: false,
    auditHistoryDays: 30,
  },
  TEAM: {
    auditsPerMonth: Infinity,
    teamMembers: 10,
    privateRepos: true,
    apiAccess: true,
    auditHistoryDays: 90,
  },
  ENTERPRISE: {
    auditsPerMonth: Infinity,
    teamMembers: Infinity,
    privateRepos: true,
    apiAccess: true,
    auditHistoryDays: 365,
    sso: true,
    onPremise: true,
  },
}
```

**Acceptance Criteria:**
- [ ] Stripe prices updated to $39 Pro, $249 Team
- [ ] Plan limits enforced in code
- [ ] Pricing page shows new tiers
- [ ] All documentation updated
- [ ] No references to old pricing

---

### Task 2: Update Positioning & Messaging (4 hours)

**Replace everywhere:**
- ❌ "Multi-agent code quality auditor"
- ✅ "Catch bugs AI coding assistants miss"

**Value Propositions to Test (A/B test these):**

**Variant A: Fear-Based (Security Focus)**
```
Headline: Catch AI coding assistant bugs before production
Subheadline: 5 AI specialists review every PR for security flaws,
            performance issues, and logic errors that Copilot misses
```

**Variant B: Aspiration-Based (Speed Focus)**
```
Headline: Ship AI-generated code with confidence
Subheadline: Automated code review in 30 seconds.
            No waiting for senior engineers.
```

**Variant C: Problem/Solution (Pain Focus)**
```
Headline: Your AI pair programmer needs a second opinion
Subheadline: Cursor and Copilot write code fast.
            We catch the bugs they miss.
```

**Recommended: Start with Variant B** (aspiration-based)
- Most positive framing
- Emphasizes speed (differentiation)
- Clear before/after transformation

**Files to update:**
- `README.md` - Update hero section
- `web/app/page.tsx` - Landing page copy
- `GETTING-STARTED.md` - Intro paragraph
- GitHub Action description

**Example README Hero:**

```markdown
# AI Code Auditor

> Ship AI-generated code with confidence

Automated code review in 30 seconds. Five AI specialists analyze your code for security, performance, correctness, and edge cases—so you can ship faster without breaking things.

**Perfect for teams using:** GitHub Copilot • Cursor • Claude Code • v0

---

## Why AI Code Auditor?

**Problem:** AI coding assistants generate code fast, but introduce subtle bugs

**Solution:** 5 specialized AI reviewers catch issues before production

- 🎯 **Correctness** - Logic errors, type safety, null handling
- 🔒 **Security** - SQL injection, XSS, hardcoded secrets
- ⚡ **Performance** - N+1 queries, inefficient algorithms
- 🛠️ **Maintainability** - Complexity, code smells, DRY violations
- 🔍 **Edge Cases** - Boundary conditions, error handling, race conditions

---

## Get Started

```bash
curl -fsSL https://get.code-auditor.com | sh
code-auditor login
code-auditor .
```

**Free trial**: 15 audits/month, no credit card required
```

**Acceptance Criteria:**
- [ ] No mentions of "multi-agent" on user-facing pages
- [ ] Value proposition tested and chosen
- [ ] All copy emphasizes benefits, not features
- [ ] Technical details moved to docs (not homepage)

---

### Task 3: Clarify Target Market (2 hours)

**Wrong Target:** "Developers using AI assistants" (too broad)

**Right Target:** "Engineering teams at startups (10-50 engineers)"

**Buyer Persona:**

**Name:** Alex, Technical Founder / Early CTO

**Demographics:**
- Age: 28-40
- Background: Ex-senior engineer at FAANG or unicorn
- Company: Series A-C startup, 10-50 employees
- Team: 5-30 developers

**Goals:**
- Ship fast to hit next milestone
- Maintain code quality as team scales
- Raise next funding round
- Build strong engineering culture

**Pain Points:**
- Code quality declining as team grows faster than senior hiring
- Junior developers need more feedback than seniors can provide
- Security vulnerabilities scary (can't afford a breach before Series B)
- Technical debt accumulating faster than they can address
- AI tools accelerating velocity but increasing risk

**Objections to Handle:**
- "We already use ESLint/SonarQube" → We catch logic bugs, not just syntax
- "Too expensive" → One security bug costs more than annual subscription
- "Another tool to manage?" → Replaces 5 separate tools (security, performance, etc.)
- "What if AI is wrong?" → Human review is final decision, this is second opinion

**Marketing Channels:**
- Product Hunt (where founders discover tools)
- Hacker News (technical credibility)
- Dev Twitter (thought leadership)
- YC Bookface (startup community)
- Indie Hackers (transparent revenue sharing)

**Update docs to reflect this persona:**
- Case studies feature startups (not solo devs or enterprise)
- Pricing page emphasizes Team tier (not Pro)
- Testimonials from CTOs/founders (not individual ICs)

**Acceptance Criteria:**
- [ ] Marketing materials speak to founders/CTOs
- [ ] Case study template references startups
- [ ] Pricing page highlights Team tier
- [ ] Solo dev use case deprioritized (but not removed)

---

### Task 4: Optimize Free Tier Strategy (2 hours)

**Current:** 5 audits/month

**Options to test:**

**Option A: Increase to 15 audits/month**
- Rationale: 5 is too low for meaningful evaluation (1 per week)
- Risk: Some users never need to upgrade
- Mitigation: Add watermark "Powered by AI Code Auditor - Upgrade to remove"

**Option B: Unlimited for public repos**
- Rationale: GitHub can verify if repo is public
- Risk: Some heavy users never upgrade
- Mitigation: Free tier gets deprioritized (slower API responses)

**Option C: Time-limited trial (14 days unlimited)**
- Rationale: Forces upgrade decision quickly
- Risk: Users forget to upgrade, churn
- Mitigation: Email reminders on day 7, 12, 14

**Recommended: Option A** (15 audits + watermark)
- Balances evaluation needs with upgrade incentive
- Watermark is social proof (viral marketing)
- Clear monthly limit creates upgrade trigger

**Implementation:**

```typescript
// web/lib/plan-limits.ts
export const PLAN_LIMITS = {
  FREE: {
    auditsPerMonth: 15, // ← Changed from 5
    watermark: true, // ← Add watermark to reports
  },
  // ...
}

// src/report/terminal.ts
if (license.plan === 'FREE') {
  console.log('\n' + '─'.repeat(60))
  console.log('⚡ Powered by AI Code Auditor')
  console.log('   Upgrade to remove this message: https://code-auditor.com/pricing')
  console.log('─'.repeat(60) + '\n')
}
```

**A/B Test Plan:**
- Week 1-2: 15 audits, no watermark (baseline conversion)
- Week 3-4: 15 audits, with watermark (test impact)
- Week 5-6: 10 audits, with watermark (find optimal limit)

**Acceptance Criteria:**
- [ ] Free tier limit updated to 15 audits/month
- [ ] Watermark added to free tier reports
- [ ] Upgrade CTA shown when approaching limit
- [ ] Email sent at 10/15, 15/15 audits used
- [ ] A/B test variants ready to deploy

---

## Messaging Framework

**What it is:**
Automated code review with 5 specialized AI agents

**Who it's for:**
Engineering teams at startups using AI coding assistants

**What pain it solves:**
AI tools write code fast, but introduce bugs you don't catch until production

**How it works:**
30-second analysis across 5 dimensions: correctness, security, performance, maintainability, edge cases

**Why it's different:**
- Deeper than static analysis (understands context)
- Faster than manual review (30 seconds vs days)
- More comprehensive than single-purpose tools (5 perspectives)

**Before/After:**
- Before: PR waits 3 days → senior finds bug → rewrite → ship
- After: PR audited in 30s → fix immediately → ship same day

---

## Landing Page Structure

**Hero Section:**
- Headline: "Ship AI-generated code with confidence"
- Subheadline: "Automated code review in 30 seconds..."
- CTA: "Start Free Trial" (15 audits, no credit card)
- Social proof: "Used by teams at [logos]"

**Problem Section:**
- "AI coding assistants are everywhere, but who's reviewing AI code?"
- Stats: "45% of developers say debugging AI code takes longer than writing it manually"

**Solution Section:**
- "5 AI specialists review every line"
- Icons + descriptions for each agent

**How It Works:**
1. Install CLI or GitHub Action
2. Run audit (30 seconds)
3. Get detailed report with actionable fixes

**Pricing Section:**
- Three tiers: Free Trial, Pro, Team
- "Most Popular" badge on Team tier
- Enterprise "Contact Sales" button

**Social Proof:**
- Testimonials from 3-5 early customers
- Logos (once available)
- "Featured on Product Hunt" badge

**FAQ Section:**
- "How is this different from SonarQube?"
- "What does it cost?"
- "Do you support my language?"
- "How accurate is it?"

**CTA Section:**
- "Ready to ship with confidence?"
- "Start your free trial" button
- "No credit card required"

---

## Success Metrics

**Before:**
- Pricing: Backwards (Team cheaper than Pro per user)
- Positioning: Technical ("multi-agent")
- Target: Too broad ("developers")
- Free tier: Unclear (5 audits may be too low/high)

**After:**
- Pricing: Proper ladder ($0 → $39 → $249 → $999+)
- Positioning: Value-focused ("Ship with confidence")
- Target: Specific (startup CTOs/founders)
- Free tier: Optimized (15 audits with watermark)

**Conversion Impact:**
- Free → Pro: Expect 3-5% (from <1%)
- Pro → Team: Expect 15-20% (from 0%)
- Visitor → Sign-up: Expect 20%+ (from 10%)

---

## Implementation Checklist

**Pricing:**
- [ ] Stripe products created ($39 Pro, $249 Team)
- [ ] Code updated with new prices
- [ ] Plan limits updated (15 free audits)
- [ ] Documentation reflects new pricing
- [ ] Existing customers grandfathered (if any)

**Positioning:**
- [ ] "Multi-agent" removed from user-facing copy
- [ ] Value proposition chosen and implemented
- [ ] README hero section rewritten
- [ ] Landing page updated
- [ ] GitHub Action description updated

**Target Market:**
- [ ] Marketing materials speak to CTOs/founders
- [ ] Case studies template created
- [ ] Testimonial collection strategy
- [ ] Sales objection handling documented

**Free Tier:**
- [ ] Limit set to 15 audits/month
- [ ] Watermark implemented
- [ ] Upgrade prompts at 10/15, 15/15
- [ ] Email notifications configured
- [ ] A/B test plan documented

**Total Time:** 8-12 hours across all tasks.
