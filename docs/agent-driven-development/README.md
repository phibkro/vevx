# Agent Driven Development (ADD)

**Development model for AI Code Auditor using AI agents as the development team.**

## What is Agent Driven Development?

Agent Driven Development (ADD) is a software development approach where AI agents, orchestrated by Claude, perform development tasks:

- **Agents by scope**: Agents specialize by codebase area (apps/web, apps/cli, packages/core), not by role
- **Role injection**: Same agent switches roles (Builder → Tester → Reviewer) via prompt
- **Context reuse**: Agents retain knowledge across tasks in their scope
- **Parallel execution**: Independent scopes run simultaneously
- **CI/CD coordination**: Automated quality gates provide feedback

## Documentation

### Planning & Prioritization
- **[PRIORITIZATION.md](./PRIORITIZATION.md)** - Complete orchestration plan with dependency graph
- **[SOFTWARE-PRACTICES.md](./SOFTWARE-PRACTICES.md)** - Development practices for AI agent teams

### Implementation Plans (Backlog)
- **[PLAN-6: Fix Failing Tests](./backlog/PLAN-6-FIX-TESTS.md)** - apps/web test fixes
- **[PLAN-7: Core Package Testing](./backlog/PLAN-7-CORE-TESTING.md)** - Backfill tests for packages/core
- **[PLAN-8: Core Product Polish](./backlog/PLAN-8-CORE-POLISH.md)** - UX improvements (error messages, progress, validation)
- **[PLAN-9: CI/CD Infrastructure](./backlog/PLAN-9-CICD-INFRASTRUCTURE.md)** - GitHub Actions, quality gates, auto-deploy

## Key Principles

### 1. Dependency Graph > Priority Formula

No scoring formula - use dependency graph instead:

```
Level 0: PLAN-6 (Fix Tests)
         ↓
Level 1: PLAN-9 (CI/CD)
         ↓
Level 2: PLAN-8 (Polish) || PLAN-7 (Testing) ← Run in parallel
```

**Why this works for agents:**
- Dependencies block progress (must respect)
- Effort is cheap (agents don't get tired)
- Risk is managed by CI/CD (retry is easy)
- Parallelization is free (no coordination overhead)

### 2. Agent Workflow

Every agent must follow this after completing a task:

1. ✅ **Verify** via CI/CD (tests, coverage, lint, build)
2. ✅ **Document** changes (ALWAYS check if docs need updates)
3. ✅ **Report** status (commit, note context usage, flag blockers)
4. ✅ **Manage context** (summarize if >80%, store patterns in MEMORY.md)

### 3. Orchestrator Decision Tree

```
New task arrives
  ↓
Identify scope (web/cli/core)
  ↓
Check for existing agent in scope
  ├─ Exists + context <80%? → RESUME with new role
  └─ Doesn't exist or full? → SPAWN new agent
  ↓
Execute in parallel if independent
  ↓
CI/CD provides feedback
```

## Execution Strategy

### Phase 1: Foundation (Sequential)
- PLAN-6 → PLAN-9
- Time: 10-14h agent time
- Outcome: Reliable tests + CI/CD

### Phase 2: Quality (Parallel)
- PLAN-8 (2 agents) || PLAN-7 (1 agent)
- Time: 3-5h wall time (parallel)
- Outcome: Professional UX + 80% coverage

### Phase 3+: Business Features
- PLAN-3 → PLAN-2 → PLAN-4 → PLAN-5
- Value-ranked within dependency graph

**Total time to production-ready**: ~21-31 agent hours

## For Human Product Managers

All documentation is markdown for easy PM review:

- **Current status**: Check git log + CI/CD dashboard
- **What's next**: See PRIORITIZATION.md dependency graph
- **What agents are doing**: Check active branches + PR descriptions
- **Documentation updates**: Agents update docs after every task

## Comparison to Traditional Development

| Aspect | Human Teams | AI Agent Teams (ADD) |
|--------|-------------|----------------------|
| **Planning** | Sprint planning, standups | Dependency graph only |
| **Coordination** | Meetings, Slack | CI/CD feedback |
| **Ceremonies** | Daily standups, retros | None (just ship) |
| **Effort estimation** | Story points, t-shirt sizes | Time estimates (cheap) |
| **Risk management** | Fear of breaking things | CI/CD catches issues |
| **Parallelization** | 2-3 humans max | As many agents as needed |
| **Context** | Tribal knowledge | Resumable agent context |
| **Documentation** | Often neglected | Mandatory after every task |

## Getting Started

**For orchestrator (Claude):**
1. Read PRIORITIZATION.md for current roadmap
2. Check dependency graph for what's unblocked
3. Spawn/resume agents as specified in plans
4. Monitor CI/CD for feedback

**For agents:**
1. Read your assigned PLAN-*.md
2. Execute tasks in specified order
3. Follow post-task checklist (verify, document, report, cleanup)
4. Resume for next task in your scope

**For human PM:**
1. Review PRIORITIZATION.md for roadmap
2. Check CI/CD dashboard for status
3. Review PRs for quality
4. Provide strategic direction
