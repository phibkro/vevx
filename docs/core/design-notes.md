# Varp Design Notes

*From the Design Document — v0.1.0 — February 2026*

Feedback loops, documentation lifecycle, open questions, related work, and implementation history. See [Design Principles](design-principles.md) and [Architecture](design-architecture.md) for the core design.

## 5. Feedback Loops

Varp operates across three timescales:

### 5.1 Fast Loop (Within Session)

The orchestrator's inner execution cycle: select → verify → resolve → dispatch → collect → verify capabilities → verify invariants → handle failure → invalidate → advance. Fully autonomous within the bounds of the plan's contracts and the orchestrator's restart strategy. The orchestrator makes all decisions it can derive mechanically from `touches` and postconditions, and escalates everything else to the human.

### 5.2 Medium Loop (Across Sessions)

Plan → execute → observe → replan. The human reviews the **manifest diff** between pre-execution and post-execution state: which tasks completed, which failed, which docs were invalidated, which interfaces broke, what the orchestrator flagged as uncertain.

The execution metrics from `log.xml` inform the next cycle: tasks that consumed disproportionate resources suggest misscoped work, high restart rates on a component suggest inadequate interface documentation, capability violations suggest incorrect `touches` derivation by the planner. These signals feed back into planning — the planner can use execution history to write tighter `touches` and decompose more carefully.

This annotated diff is the decision surface. The human decides whether to proceed, replan, or intervene. The planner agent (a separate session, never running simultaneously with the orchestrator) produces or refines the next plan based on the current state, guided by the human's intent.

**This is where 90% of the system's value lives.** The medium loop is what prevents the system from drifting — each cycle recalibrates based on actual results rather than assumptions.

### 5.3 Slow Loop (Over Time)

The framework itself evolving. T1 principles update as patterns emerge across many execution cycles. The manifest grows as the project adds components. Plan templates improve as failure modes are discovered. The orchestrator's strategy becomes more sophisticated. Aggregate execution metrics across many plans reveal which components are expensive, which task types fail often, and where the documentation investment has the highest return.

## 6. Documentation as System State

Documentation rot actively degrades agent performance because agents trust context literally. A stale doc isn't just unhelpful — it's actively harmful, producing confident but wrong behavior.

Varp treats documentation as a first-class concern in the work cycle:

**Doc updates are part of the subagent's scope.** When a task writes to a component, updating that component's docs is part of the task — not a separate orchestrator step. The subagent has the context to know what changed and how the docs should reflect it. The orchestrator verifies freshness after task completion.

**Invalidation cascades through dependencies.** When component A's docs change, the manifest's `deps` graph identifies every component that consumes A's interface. During active execution, the `touches` metadata enables targeted refresh — only tasks that actually read from A need updated context. Between sessions, the manifest-level dependencies flag stale assumptions for the next planning cycle, even without an active plan.

**Doc visibility uses the README.md convention.** Docs named `README.md` are public — loaded for tasks that read from or write to the component (API surface, behavioral guarantees). All other docs are private — loaded only for writes (implementation details, algorithms). This convention-over-configuration approach replaces explicit tagging and ensures each task gets exactly the context it needs.

## 7. Open Questions

### 7.1 Medium Loop Interface

The medium loop is underspecified. The manifest diff concept is clear in principle, but the concrete UX — what the human sees, what decisions they can make, how replanning integrates with the existing plan — needs design work. This is the most important open problem because the medium loop is where system value concentrates.

### 7.2 Semantic Conflicts

Git detects structural merge conflicts (same lines changed). Two agents can make semantically incompatible changes to different files that git merges cleanly. The postcondition and invariant checks catch some of these, but they only test what was explicitly contracted. Uncontracted semantic conflicts — changes that are individually correct but collectively wrong in ways nobody anticipated — remain a gap.

### 7.3 Decision Authority

When does the orchestrator proceed autonomously vs. ask the human? The restart strategies handle failure cases mechanically, but gray areas remain: a task that completes with `PARTIAL` status, a postcondition that passes but with warnings, a capability violation that looks like a `touches` derivation error rather than agent misbehavior. A decision authority matrix that encodes escalation thresholds should be a framework-level concept. The exact thresholds need empirical tuning through real usage.

### 7.4 `touches` Accuracy

The concurrency model is only as good as the `touches` declarations. If a task declares `reads: auth` but actually modifies auth's behavior through a shared utility or transitive dependency, the hazard detection misses it. Capability verification catches *writes* to undeclared components after the fact, but undeclared *reads* — where a task depends on a component's behavior without declaring it — remain invisible until postcondition failures reveal the gap. Whether additional static analysis (e.g., scanning file-level imports to infer component boundaries) can improve `touches` accuracy without adding brittleness is worth investigating.

### 7.5 Interface Completeness

The behavioral assumptions in interface docs are human-written because the important ones can't be mechanically extracted. But how do you know you've documented all the important assumptions? Missing interface assumptions are the most dangerous failure mode — the system has no way to verify what it doesn't know about. This is fundamentally unsolvable in general, but heuristics for surfacing likely-missing assumptions (e.g., components that interact frequently but have sparse interface docs, or high capability-violation rates on a component boundary) could help.

### 7.6 Execution Cost Visibility

~~Budget calibration was the original framing — dropped per [ADR-001](../decisions/adr-001-budget-observability.md).~~ The remaining question is how to surface execution cost data usefully. `log.xml` captures per-task token/time/tool metrics, but the medium loop review currently presents them as a flat table. Whether aggregate cost trends across sessions (e.g., "auth tasks consistently cost 2x more than api tasks") can inform future planning — and what the right storage and retrieval mechanism is — needs design work.

### 7.7 Warm Agent Staleness

Resuming a subagent session preserves its accumulated context, but that context may be stale if other tasks have modified components in its scope since the session was suspended. The orchestrator checks doc freshness before dispatch, but a warm agent's *implicit* understanding (patterns it noticed, assumptions it formed) can't be freshness-checked. Whether warm agent resumption should be limited to cases where no intervening writes occurred, or whether a freshness summary injected at resumption is sufficient, is an open question.

## 8. Manifest Extensions

Four optional component fields that give the planner and orchestrator richer signals without changing the core scheduling model. All are implemented — see [Manifest Schema](../../packages/core/src/manifest/README.md) for the full reference.

### 8.1 `tags` — Freeform Labels

```yaml
auth:
  path: ./src/auth
  tags: [security, critical, api-boundary]
```

Arbitrary string labels for filtering and grouping. The planner can scope questions ("which security-tagged components does this affect?"), and the orchestrator can apply per-tag policies (e.g., require review for `critical` components). No schema validation beyond string array — users define their own taxonomy.

### 8.2 `test` — Per-Component Test Command

```yaml
auth:
  path: ./src/auth
  test: bun test src/auth/
```

Overrides the default test discovery (`varp_scoped_tests` recursively finds `*.test.ts` under the component path). When set, the command appears in `custom_commands` on the scoped test result, and `run_command` uses it instead of (or in addition to) discovered test files. Useful when components have non-standard test setups, integration tests that require flags, or monorepo tools with their own test runners (`nx run auth:test`, `turbo run test --filter=auth`).

### 8.3 `env` — Runtime Prerequisites

```yaml
database:
  path: ./src/database
  env: [POSTGRES_URL, REDIS_URL]
```

Environment variables or external services the component requires. Informational — the orchestrator can check these before dispatching tasks to prevent wasted agent work on tasks that will fail at verification time due to missing prerequisites.

### 8.4 `stability` — Change Frequency Signal

```yaml
auth:
  path: ./src/auth
  stability: stable

experiments:
  path: ./src/experiments
  stability: experimental
```

Three levels: `stable` (rarely changes, many dependents), `active` (regular development), `experimental` (frequent changes, few dependents). Informs the planner's scope estimation (stable components need less discovery) and the orchestrator's restart strategy (experimental failures are more likely isolated). Default: `active`.

### 8.5 Design Considerations

These extensions are additive — all fields are optional with sensible defaults. They enrich the planner and orchestrator's decision-making without changing the scheduling model (`touches` + hazard detection remains the core).

Named **mutexes** are implemented as an optional `<mutexes>` element on plan tasks (e.g., `<mutexes>db-migration, port-3000</mutexes>`). Tasks sharing a mutex name are placed in separate waves regardless of their `touches` declarations. MUTEX hazards feed into wave computation (like WAW) but are excluded from critical path (scheduling constraint, not data flow). The validator warns on dead mutexes (names used by only one task). Restart strategy checks mutex overlap alongside write-set overlap.

## 9. Relationship to Existing Work

### 9.1 What Varp Borrows

**Tiered memory architectures** (MemGPT, Letta): The T1/T2/T3 knowledge hierarchy is a direct application of tiered memory management to agent context.

**MVCC and concurrency control** (PostgreSQL, Convex): Snapshot isolation via git worktrees, optimistic execution with pessimistic scheduling, postcondition verification as serialization checks.

**CPU pipeline theory:** RAW/WAR/WAW hazard detection for task scheduling, register renaming via context snapshotting, speculative execution via parallel worktrees.

**OS process management:** Process accounting (structured execution metrics as /proc), capability restrictions (`touches` as namespace boundaries), wave cancellation (process group signals), fork-and-COW semantics (warm agent resumption).

**Erlang/OTP supervision trees:** Two-layer constraint as flat supervision hierarchy. Restart strategies (isolated retry, cascade restart, escalate) derived mechanically from dependency metadata rather than configured per-worker. The supervisor (orchestrator) has a global view; workers (subagents) are isolated.

**Orchestrator-worker patterns:** Centralized coordination with distributed execution. Well-established in both human organizations and distributed systems.

### 9.2 What's Novel

**The dual agent model.** Agents as processes with functional interfaces — defined by the 3D model (domain/action/values as function signature), executed with process semantics (lifecycle, resources, capabilities, failure handling). The functional layer governs definition and dispatch; the process layer governs execution and supervision.

**Static vs. dynamic as the fundamental architectural principle.** The claim that most agent failures trace to confusing invariant knowledge with volatile context, and that the entire framework follows from rigorously maintaining this distinction.

**`touches` as unified scheduling and capability mechanism.** Read/write declarations serving triple duty: concurrency hazard detection (scheduling), capability grants (enforcement), and restart strategy derivation (failure handling). One declaration, three enforcement layers.

**Documentation lifecycle as a first-class concern.** Treating docs not as artifacts but as system state that must be maintained with the same rigor as code, with dependency-aware invalidation cascading through the component graph. The interface/internal distinction as the mechanism for automatic context resolution.

**Planner-orchestrator session separation.** Planning and execution as distinct sessions communicating through plan artifacts, with the planner agent specializing in turning vague human intent into verifiable, actionable plans through clarifying dialogue.

**The DBMS framing applied to software project management by AI agents.** The systematic mapping of manifest→schema, plan→transaction, orchestrator→transaction manager, git→MVCC, docs→materialized views, verification→constraint checking — extended with process management semantics for the execution layer.

## 10. Implementation Path

All build steps (1-8) are complete. See the [architecture doc](../../packages/core/docs/architecture.md) for current module structure and algorithms.

### 10.1 Technical Choices

**TypeScript MCP server.** The MCP SDK handles JSON-RPC serialization, capability negotiation, and transport. Varp implements tool logic only. Runs in-process within the Claude Code plugin.

**YAML for the manifest, XML for plans.** YAML is human-maintained and human-readable. XML is agent-consumed and structurally validated. Markdown for narrative documentation.

**Prompt caching for cost efficiency.** Cache T1 knowledge (manifest, skill protocol) at the system prompt level. Cache T2 knowledge (component docs) per scope. Token counting before dispatch to stay within rate limits. Batch API (50% discount) for bulk postcondition verification.

---

## Appendix A: Naming

**Varp** is Norwegian for "warp" — the vertical threads in weaving that provide the structural foundation everything else weaves through. Domain and values are the warp: static invariants that hold the system together. Dynamic context is the weft, passing through on every invocation. Short, typeable, available as a package name, and a meaningful metaphor that maps precisely to the architecture.
