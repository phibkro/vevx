# ADR-003: Position varp as a graph-aware companion to superpowers

**Status:** Accepted
**Date:** 2026-02-19  
**Author:** Philip  
**Deciders:** Philip (sole maintainer)

## Context

Varp is a Claude Code plugin that combines codebase analysis with manifest-aware agent orchestration. It consists of four packages:

- **@vevx/varp** — MCP server: manifest parsing, graph analysis, dependency-aware scheduler, capability enforcement
- **@vevx/audit** — compliance audit engine and CLI for multi-agent code review
- **@vevx/varp** — Claude Code plugin: skills, hooks, plugin manifest
- **@vevx/varp** — deterministic manifest tooling: init, graph, lint, freshness, validate, coupling

The central artifacts are `varp.yaml` (a manifest declaring project components, paths, dependencies, tags, and stability levels) and the `CodebaseGraph` (a weighted graph combining structural, behavioral, and semantic signals to surface architectural insights). Plans (`plan.xml`) declare tasks with explicit read/write scopes and contracts, and the scheduler emits execution waves respecting the dependency graph.

Varp's architecture separates into three layers (see ADR-002):

| Layer                          | Compiler Analog       | Input → Output                      |
| ------------------------------ | --------------------- | ----------------------------------- |
| **Analysis** (parser + passes) | Lexer + Optimization  | codebase → enriched `CodebaseGraph` |
| **Scheduler**                  | Instruction selection | graph + goal → `Wave[]`             |
| **Executor**                   | Interpreter / Runtime | waves → side effects                |

The analysis layer is independently valuable: "point this at a repo, get a coupling diagnostic" is a product before any AI is involved.

### The relational analysis engine

Varp's core analytical differentiator is the relational architecture analysis system (see design doc v5). It combines three independent signal layers — structural (import graphs), behavioral (git co-change frequency with graduated `1/(n-1)` weighting), and semantic (manifest declarations and tags) — and preserves them as separate dimensions rather than collapsing into a single score.

The primary output is a **coupling diagnostic matrix**:

|                          | High Co-Change                    | Low Co-Change                  |
| ------------------------ | --------------------------------- | ------------------------------ |
| **High Import Coupling** | Explicit module (expected)        | Stable interface (good design) |
| **Low Import Coupling**  | **Hidden coupling (investigate)** | Unrelated (expected)           |

The highest-value findings live in the "hidden coupling" quadrant: files coupled through implicit contracts (shared DB schemas, API boundaries, conventions) invisible to static analysis. No existing tool surfaces this specific diagnostic.

Node-level properties include hotspot scoring (change frequency × LOC) and complexity trend direction, both nearly free given the existing git walk. Knowledge maps (developer-to-file affinity from git blame) are planned as a future signal layer that enables Conway's Law validation as a natural graph query.

### Superpowers

Superpowers (github.com/obra/superpowers, 41k stars, 18k installs) is the dominant Claude Code development methodology plugin. It provides socratic brainstorming, markdown-based planning, subagent-driven development with two-stage code review, enforced TDD, git worktree isolation, and a composable skills framework.

Both plugins have planning and execution capabilities, but they solve different problems:

- **Superpowers** optimizes for _how agents work_: disciplined process (TDD, code review, systematic debugging), task decomposition, and quality enforcement.
- **Varp** optimizes for _what the project looks like_: structural awareness (component topology, coupling patterns, drift detection), scope enforcement, contract verification, and architectural consistency.

These are complementary, not competing. But varp currently also ships brainstorming and general-purpose planning UX that overlaps with superpowers' stronger offering in that space.

### Market context

Anthropic's "Measuring AI agent autonomy in practice" research (2026-02-18) shows agents working autonomously for increasingly long periods (99.9th percentile turn duration nearly doubled to 45+ minutes in three months). As autonomy increases, the risk of architectural drift compounds silently. Correctness (does it work?) is measurable. Maintainability (does it fit?) is not, unless the project's structure is explicitly modeled and behavioral coupling is tracked automatically.

CodeScene's research validates this: AI coding assistants increase defect risk 30% in unhealthy code. Their solution is a reactive quality gate (Code Health score tells agents "don't make this file worse"). Varp's solution is proactive planning context (the graph tells agents "here's what else you need to consider when you touch this file"). One is a guardrail, the other is a map. They're complementary, not competing.

No other Claude Code plugin addresses this structural awareness gap.

## Decision

Position varp as a **graph-aware companion to superpowers** (and other workflow plugins) by:

1. **Keeping** varp's core: the relational analysis engine (`CodebaseGraph`), manifest, dependency-aware scheduler, scope enforcement, contract verification, audit engine
2. **Dropping** the general-purpose brainstorming and planning UX where superpowers already wins
3. **Adding** lifecycle hooks that inject graph-derived insights into any workflow
4. **Adding** the ability to consume superpowers-generated plans and enrich them with graph-derived constraints
5. **Designing** for plugin-agnosticism (works with superpowers, vanilla Claude Code, or any other workflow) while optimizing for superpowers as the primary integration target

### What varp keeps

| Capability                                   | Why                                                                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `CodebaseGraph` (relational analysis engine) | **Core differentiator.** Co-change parser, coupling diagnostics, hotspot scoring, signal independence. No other plugin builds a behavioral dependency graph. |
| `varp.yaml` manifest                         | Semantic signal layer. Declares intent (components, dependencies, tags, stability) that the graph validates against observed behavior.                       |
| Dependency-aware wave scheduler              | Enables safe parallel execution that respects component relationships. `TaskDefinition[] → Wave[]` as a pure function.                                       |
| Capability enforcement (read/write scopes)   | Prevents tasks from touching files outside their declared scope.                                                                                             |
| Contract verification (pre/post/invariants)  | Ensures structural guarantees hold across task execution.                                                                                                    |
| `@vevx/audit` compliance engine              | Multi-agent code review against standards (OWASP, HIPAA, PCI-DSS), enriched by graph-derived architectural context.                                          |
| `@vevx/varp` deterministic tooling            | `varp init`, `varp graph`, `varp lint`, `varp coupling`, `varp freshness`, `varp validate`.                                                                  |
| `plan.xml` for manifest-aware execution      | Structured plans with scopes and contracts — used when varp executes directly.                                                                               |

### What varp drops

| Capability                   | Why                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Socratic brainstorming skill | Superpowers' brainstorming is mature, community-tested, and deeply integrated. Competing here adds no value. |
| General-purpose planning UX  | Superpowers' `/write-plan` and plan format have adoption. Varp should enrich plans, not replace them.        |

### What varp adds

| Capability                          | Purpose                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SessionStart graph injection        | Load manifest topology, coupling diagnostics, hotspot data, and relevant component docs into session context. Any planner (superpowers or otherwise) gets structural awareness automatically.                                  |
| PostToolUse coupling monitoring     | After file-modifying operations, query the graph: "what else typically changes with this file?" Lightweight timestamp-based staleness check as fast signal, with on-demand graph-based drift detection for richer diagnostics. |
| Post-execution audit dispatch       | After a subagent completes, dispatch audit to verify architectural consistency using the graph as evidence.                                                                                                                    |
| `/varp:coupling` in-session command | Surface coupling diagnostics mid-session: "what files are behaviorally coupled to the ones I'm touching?"                                                                                                                      |
| Stop session summary                | Summarize session impact: which components modified, coupling patterns affected, drift indicators, scope violations.                                                                                                           |

## Integration architecture

### How the two plugins coexist

Claude Code runs plugin hooks in parallel. Superpowers injects its methodology. Varp injects the project's structural reality. Both hooks fire independently — no coordination required.

```
Session starts
  ├── superpowers SessionStart → injects methodology (TDD, brainstorming, etc.)
  └── varp SessionStart → injects graph context (topology, coupling hotspots, freshness)

User says "add rate limiting to auth endpoints"
  ├── superpowers brainstorming activates → socratic design refinement
  │   (varp's injected graph context means brainstorming has structural awareness:
  │    "auth/session.ts has hidden coupling with db/migrations — consider migration impact")
  ├── superpowers write-plan → produces markdown plan
  │   (structurally informed because the graph is in context)
  └── optional: /varp:coupling auth/ → explicit coupling diagnostic before execution

Execution (two modes):
  Mode A: superpowers executes (subagent-driven-development)
  │   ├── single-component tasks: superpowers handles, varp monitors via PostToolUse
  │   └── varp PostToolUse hooks flag coupling implications of file changes
  │
  Mode B: varp executes (manifest-aware scheduler)
      └── multi-component tasks with cross-cutting dependencies:
          varp schedules waves, enforces capabilities, verifies contracts

Post-execution:
  ├── superpowers code-reviewer → spec compliance + code quality
  ├── varp audit dispatch → architectural consistency (graph-based drift detection)
  └── varp Stop hook → session impact summary
```

### Execution mode guidance

The scheduler adds value when tasks have **cross-component dependencies** — wave scheduling, scope enforcement, and contract verification matter when a change touches multiple components with declared relationships. For single-component, single-concern tasks, superpowers' subagent dispatch is sufficient and varp just monitors. The selection heuristic: if the plan's `touches` declarations span more than one component in the manifest, suggest varp execution.

### Hook integration points

| Hook event     | Matcher                  | Varp action                                                                                                                   | Latency target |
| -------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `SessionStart` | —                        | Load `varp.yaml`, compute graph summary (coupling hotspots, freshness state, component health), inject as `additionalContext` | < 200ms        |
| `PostToolUse`  | `Write\|Edit\|MultiEdit` | Timestamp-based staleness check (fast). If file is in a coupling hotspot, append "files that typically co-change" note.       | < 50ms         |
| `SubagentStop` | —                        | Optionally dispatch graph-based drift audit for affected components.                                                          | On-demand      |
| `Stop`         | —                        | Session impact summary: components modified, coupling implications, freshness state.                                          | < 100ms        |

The PostToolUse hook deliberately uses the cheap signal (timestamps) for inline feedback. The expensive signal (full graph re-analysis) runs on-demand via CLI, audit dispatch, or explicit `/varp:coupling` queries. This avoids the latency concern of running graph queries on every file write.

### Relationship to superpowers

**Varp is superpowers-agnostic but superpowers-optimized.**

- Works standalone with vanilla Claude Code (user writes plans manually or uses varp's own planning)
- Works with superpowers (enriches superpowers' plans and monitors superpowers' execution)
- Works with any other workflow plugin that produces plans and executes tasks

What varp provides that superpowers doesn't have:

- `CodebaseGraph` with multi-signal coupling diagnostics
- Manifest-declared project topology with dependency validation
- Scope enforcement (tasks can only touch declared files)
- Contract verification (pre/post/invariants across task boundaries)
- Compliance audit engine

What superpowers provides that varp doesn't compete with:

- Socratic brainstorming methodology
- TDD enforcement (red-green-refactor)
- Two-stage code review (spec compliance + code quality)
- Git worktree isolation
- Skill testing framework

### The graph makes context injection automatic

Rather than building a `/varp:enrich` command that users must remember to run on completed plans, the SessionStart hook injects graph context so that any planner naturally incorporates structural constraints. The LLM sees "auth/session.ts has hidden coupling with db/migrations/024.sql (co-change score 0.87)" during brainstorming and accounts for it without being told to run an enrichment step.

Enrichment is automatic and invisible. Plans produced in a varp-aware session are structurally informed by default. If users want explicit coupling diagnostics mid-session, `/varp:coupling <path>` surfaces the per-file neighborhood query.

## Alternatives considered

### Alternative 1: Abandon varp's orchestrator, become a pure documentation layer (ADR-001)

**Rejected.** This was the initial pivot proposal. It replaced the `CodebaseGraph` and manifest with MODULE.md prose files and timestamp-based staleness tracking. The realization: MODULE.md + tracking.json reinvents `varp.yaml` as prose that drifts faster, is harder to validate programmatically, and can't be queried by agents. Timestamp-based staleness ("doc changed after source") is crude compared to graph-based drift detection ("coupling pattern shifted"). The graph is the analytical foundation, not an afterthought.

### Alternative 2: Continue competing with superpowers across the full workflow

**Rejected.** Superpowers has 41k stars, 18k installs, deep Claude Code integration, and a mature community. Competing on brainstorming and general-purpose planning is not viable. Varp should focus where superpowers has no presence: structural awareness and architectural enforcement.

### Alternative 3: Merge into superpowers (contribute upstream)

**Deferred.** The manifest system, relational analysis engine, and dependency-aware scheduling are architecturally distinct from superpowers' skill-based methodology. Different data models, different concerns, different upgrade cadences. A standalone companion lets varp iterate independently. If the integration proves valuable and there's mutual interest, an upstream merge or formal partnership could happen later.

### Alternative 4: Build varp's features as superpowers skills

**Rejected.** Varp needs persistent state (manifest, `.varp/` graph cache, audit logs), an MCP server for deterministic tooling, and lifecycle hooks that go beyond what a skill typically manages. Skills are stateless protocols; varp is a stateful system. Some varp features could be exposed as skills that superpowers can invoke, but the core must remain a plugin.

### Alternative 5: Ignore superpowers, target enterprise compliance only

**Considered.** Varp could target enterprise teams doing compliance-focused development (via `@vevx/audit`) rather than individual developers using superpowers. This isn't mutually exclusive — the audit engine and relational analysis are independently valuable for compliance. But the superpowers integration provides faster validation and broader reach, and the graph-based analysis benefits both audiences.

## Consequences

### Positive

- Clear positioning: superpowers = how agents work, varp = what the project looks like
- The relational analysis engine (co-change parser, coupling diagnostics, signal independence) is the core differentiator, not just the manifest
- Access to superpowers' 18k+ user base without requiring workflow migration
- Reduced surface area (dropping brainstorming/planning UX) means faster iteration on the graph engine and audit
- Graph context injection is automatic via SessionStart — users don't need to learn new commands for basic value
- Manifest-aware scheduling remains available for complex multi-component changes
- Aligns with the trend toward longer autonomous agent sessions where architectural drift compounds

### Negative

- Varp loses its identity as a complete standalone workflow for users who don't use superpowers (mitigated: varp still works standalone, it just doesn't compete on brainstorming)
- Two plugins running hooks simultaneously adds latency (mitigated: hooks have tight latency targets, expensive analysis is on-demand)
- Users must maintain `varp.yaml` in addition to superpowers' methodology (mitigated: `varp init` scaffolds from existing project structure)
- The graph needs git history to produce behavioral signals — new repos or repos with shallow clones have degraded analysis

### Risks

- Superpowers may eventually add manifest/dependency awareness, reducing varp's differentiation (mitigated: the relational analysis engine with signal independence and coupling diagnostics is a deeper technical moat than just "having a manifest")
- The `varp.yaml` manifest could become a maintenance burden if projects change structure frequently (mitigated: gradual declaration model — inference fills gaps, manifest is optional enrichment, not a prerequisite)
- Jesse (superpowers author) may have opinions about companion plugins that conflict with this approach (mitigated: open discussion early, design for plugin-agnosticism)

## Implementation phases

### Phase 1: Graph engine and hooks (no superpowers dependency)

The foundation. Build the relational analysis engine and hook integration surface. This provides value to any Claude Code user.

1. ~~Implement co-change parser~~ **DONE** — `analysis/co-change.ts`
2. ~~Implement coupling diagnostic matrix~~ **DONE** — `analysis/matrix.ts`
3. ~~Implement hotspot scoring and complexity trends~~ **DONE** — `analysis/hotspots.ts`
4. ~~Implement `.varp/` incremental cache~~ **DONE** — `analysis/cache.ts`
5. ~~Expose via CLI and MCP tools~~ **DONE** — `varp coupling`, `varp summary`, MCP tools
6. ~~Implement SessionStart hook with graph summary~~ **DONE** — delegates to `varp summary`
7. ~~Implement PostToolUse hook with coupling neighborhood~~ **DONE** — reads `.varp/summary.json`
8. ~~Implement Stop hook: session impact summary~~ **DONE** — `session-stop.sh`
9. ~~All hooks fast and fail gracefully~~ **DONE** — CLI-cached, graceful fallbacks

### Phase 2: Remove competing UX

10. ~~Remove/deprecate brainstorming skill~~ **N/A** — varp never had one (superpowers provides this)
11. ~~Remove/deprecate general-purpose planning UX~~ **N/A** — varp:plan is manifest-aware, not general-purpose
12. ~~Update documentation to position as structural awareness layer~~ **DONE** — plugin.json, CLAUDE.md, hooks README
13. ~~Keep plan.xml and manifest-aware execution~~ **DONE** — unchanged

### Phase 3: Superpowers integration

14. Test two-plugin experience (superpowers + varp hooks) on real projects
15. Document the combined workflow
16. ~~Build `/varp:coupling` in-session command~~ **DONE** — `skills/coupling/SKILL.md`
17. Study superpowers' plan format for optional ingestion (if stable enough to build against)

### Phase 4: Community and ecosystem

18. Open discussion on superpowers repo about companion plugin patterns
19. Publish guide: "Using varp with superpowers for maintainable AI-assisted development"
20. Gather feedback and iterate on graph context injection quality
21. Explore knowledge maps (developer-to-file affinity) as next signal layer

## Open questions

1. **Graph summary compression:** The SessionStart hook needs to inject a useful graph summary without overwhelming the context window. What's the right compression? Top N coupling hotspots, component health summary, freshness flags? What's the token budget?
2. **Hook performance:** What's the measured latency of computing a graph summary at session start? The co-change graph is cached, but summary computation still needs to run.
3. **Shallow clone degradation:** Many CI environments and some developers use shallow clones. How does the co-change parser degrade gracefully? Minimum commit depth for useful signal?
4. **Community engagement:** Should varp be listed on superpowers' marketplace? Is there precedent for companion plugins in the superpowers ecosystem?
5. **Zero-config experience:** Can the graph engine provide useful output with no manifest at all (fully inferred mode)? How good is `varp init` at scaffolding from existing project structure (Nx, Turborepo, moon graph import)?

## References

- Varp: https://github.com/phibkro/vevx
- Superpowers: https://github.com/obra/superpowers
- ADR-002: Three-Layer Architecture (analysis/scheduler/executor)
- Relational Architecture Analysis Design Doc v5
- CodeScene (Adam Tornhill, _Your Code as a Crime Scene_, _Software Design X-Rays_): prior art for behavioral code analysis
- Anthropic "Measuring AI agent autonomy in practice" (2026-02-18): https://anthropic.com/research/measuring-agent-autonomy
- Claude Code hooks API: https://code.claude.com/docs/en/hooks-guide
- Claude Code plugin system: https://code.claude.com/docs/en/discover-plugins
