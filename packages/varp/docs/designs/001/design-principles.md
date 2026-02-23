# Varp Design Principles

_From the Design Document — v0.1.0 — February 2026. See also: [Architecture](design-architecture.md), [Notes](design-notes.md), [Core Internal](../../architecture.md)._

## 1. Problem

AI agent systems fail in predictable ways. Not because agents can't reason — they're remarkably good at applying general principles to specific situations — but because they operate on stale, incomplete, or silently wrong information and have no reliable mechanisms for detecting this.

The root cause is a failure to distinguish between what's static and what's dynamic. Agent prompts mix invariant instructions with volatile context. Documentation drifts from reality. Agents fill gaps in their knowledge by confabulating plausible-sounding answers from outdated assumptions. Multi-agent systems compound this by letting context degrade across handoffs, layers of indirection, and peer-to-peer communication where no single node maintains a coherent picture.

**Hallucination is agents filling dynamic gaps with static assumptions.** Most agent failures trace to this single confusion. An agent "knows" the API returns JSON because that was true when its context was loaded. It doesn't know the API was migrated to Protocol Buffers last week. It will confidently generate JSON parsing code and the error will be silent until runtime.

Current frameworks (LangChain, CrewAI, LangGraph) solve plumbing — how to wire agents together, route messages, manage tool calls. They don't solve context lifecycle: what information is fresh, what's stale, who's responsible for keeping it current, and what happens when it goes wrong.

Varp addresses this gap.

## 2. Core Principles

### 2.1 Static vs. Dynamic: The Fundamental Distinction

Everything an agent operates on falls into one of two categories:

**Static (invariant across invocations):** Domain expertise, value orderings, architectural principles, coding standards. These change slowly, are maintained by humans, and can be trusted once loaded. If they're wrong, the system is misconfigured, not malfunctioning.

**Dynamic (changes between invocations):** Project state, file contents, documentation, dependency versions, test results. These change frequently, can become stale at any moment, and must be verified before use. If they're wrong, the system has a context rot problem.

The architectural decision follows directly: **trust static encoding, obsess over dynamic injection.** Invest effort in getting static knowledge right once. Invest infrastructure in ensuring dynamic context is fresh every time.

### 2.2 The Dual Agent Model: Functional Interface, Process Execution

Agents exhibit two distinct natures that map to different engineering traditions. Their _interface_ is functional — you define what an agent does the same way you define a function. Their _runtime behavior_ is process-like — they have lifecycles, accumulate state, consume resources, and fail in ways that need structured handling. Varp models both explicitly.

#### The Functional Interface (3D Model)

Agents are defined as functions with three dimensions plus input:

**Domain (invariant — precondition):** What the agent knows. "You are a senior TypeScript engineer." This constrains the space of competent behavior. It holds true across every invocation.

**Values (invariant — postcondition):** What the agent prioritizes. "Correctness over speed, maintainability over cleverness." This is a priority ordering that determines how the agent resolves tradeoffs. It doesn't change per task.

**Action (transformation):** What the agent does. Review, implement, research, plan. This defines the shape of output given input.

**Context (input — the only thing that varies):** The project state, relevant documentation, specific files, task requirements. This is the only dimension that changes between calls, and the only dimension that can be silently wrong.

Effective prompting often compresses multiple dimensions into a single phrase. "You are a senior engineer reviewing code for correctness" sets domain, values, and action simultaneously. This compressed form activates behavior more naturally than explicit declaration, but the dimensions are still there and can be varied independently.

**Saved prompts work best when action is static.** Fix the transformation, parameterize everything else. This is currying — partially apply the action, get back a reusable function that takes (domain, values, context) as arguments.

The 3D model governs how agents are _defined_ and _dispatched_. The manifest and plan are the functional layer — declarative, compositional, concerned with what agents should do.

#### The Process Execution Model

Agents _execute_ as processes. They have duration, accumulate state during execution, consume resources (tokens, time, API calls), can be suspended and resumed, and fail in ways more complex than "return or throw." A function either returns a value or raises an exception. A process can hang, leak resources, produce partial results, corrupt shared state, or fail silently.

This distinction has concrete architectural consequences:

**Lifecycle management.** Agents start, run, and terminate. The orchestrator must track their state: pending, running, completed, failed, cancelled. Warm agent resumption is process suspension and restart — the subagent's accumulated context is preserved across invocations, like a process swapped back into memory.

**Process accounting.** Processes have resource consumption metrics (cpu time, memory, I/O). Agent tasks similarly need observable metrics — tokens consumed, time elapsed, tools invoked. An agent that has burned 50k tokens without converging is probably stuck, not thorough. The original design specified per-task budget enforcement, but this was dropped ([ADR-001](../decisions/adr-001-budget-observability.md)) — the platform lacks enforcement APIs, and estimation has no reliable basis. Resource consumption is tracked as execution metrics for observability, not as limits for enforcement. The platform's own context window and user spend controls provide the ceiling.

**Failure modes.** The `COMPLETE|PARTIAL|BLOCKED|NEEDS_REPLAN` discriminated union is modeling process exit states, not function return types. `PARTIAL` means the process did useful work but couldn't finish — like a process killed by OOM that managed to flush some output. `BLOCKED` means it's waiting on an external condition. `NEEDS_REPLAN` means the task's assumptions were wrong — the process discovered its preconditions don't hold.

**Capability restrictions.** Processes run in namespaces with restricted views of system resources. Agent tasks should be similarly constrained: a subagent dispatched with `touches writes="auth" reads="api"` should only be able to modify files in auth's path and read files in api's path. `touches` declarations become capability grants, verified on commit (Section 3.4).

**Process accounting.** The system tracks per-task resource consumption: tokens used, tools invoked, files modified, time elapsed, verification pass/fail rate. This data feeds into `log.xml` as structured execution metrics, enabling slow-loop questions like "which component is most expensive to work on?" and "which task types have the highest failure rate?"

The orchestrator is the process manager — the scheduler, supervisor, and resource controller. It operates on the functional definitions (3D model, plans, manifests) but manages execution using process semantics.

This pattern is well-established: Erlang processes have functional interfaces but process semantics. Goroutines are launched with function calls but have thread-like lifecycles. OS threads start by passing a function pointer. The function defines _what_; the process defines _how it executes_.

### 2.3 Tiered Knowledge Architecture

Not all knowledge is needed at all times. Loading everything creates noise; loading nothing creates gaps. The solution is tiered loading:

**T1 — Always loaded:** General principles, architectural conventions, the prompting framework, crosscutting invariants. This is the agent's "working memory" that's always available. Kept small and stable.

**T2 — Load on demand:** Specific patterns, component documentation, current project state, inter-component interfaces. Loaded when the orchestrator dispatches work on a relevant component.

**T3 — Rarely used:** Extensive documentation, historical decisions, research references, edge-case handling. Loaded only when explicitly needed for unusual situations.

This implicitly tells agents "reason from principles first, look up specifics when needed." It provides graceful degradation — an agent without T2 context can still reason from T1 principles, producing a less precise but not fundamentally wrong result.

### 2.4 Two-Layer Constraint (Supervision Tree)

**Only two agent layers exist: orchestrator and subagents.** Subagents cannot spawn sub-subagents. Every additional layer creates indirection where context gets lost and accountability becomes unclear.

This is a flat supervision tree. The orchestrator is the supervisor; subagents are workers. The supervisor is responsible for starting workers, monitoring their health, handling their failures, and deciding restart strategy. Workers do their assigned task and report results — they never coordinate with each other directly.

Information flows in one direction: orchestrator → subagent → result → orchestrator → next subagent. No agent ever needs to know about another agent's existence. This turns a potentially cyclic graph into a DAG, eliminating an entire class of coordination bugs.

The orchestrator can pass **observations** from completed tasks to upcoming tasks as enriched context. "Task 1 implemented rate limiting using Redis; task 3 should document the Redis dependency." This is not subagent-to-subagent communication — it's the supervisor updating environment variables between process launches. The orchestrator is the only node with a global view, and it uses that view to improve context for subsequent dispatches.

**Restart strategies** (borrowed from Erlang/OTP) determine what happens when a subagent fails:

- **Isolated retry:** The failed task's write set doesn't overlap with any completed task's read set in subsequent waves. Safe to retry — delete the worktree, redispatch. The nondeterminism concern is bounded: retry is unsafe if you need _identical_ output, but valid if you're checking _postconditions_. A retry that produces different code but passes the same postconditions is a successful recovery. Contract-mode tasks are particularly retry-friendly.
- **Cascade restart:** The failed task's output is consumed by later tasks that have already been dispatched or completed. The failure invalidates downstream work. The orchestrator must cancel the affected wave (if in progress) and restart from the failed task forward.
- **Escalate to human:** The failure indicates a planning problem, not an execution problem — preconditions were wrong, the task was misscoped, or postconditions are unsatisfiable. No amount of retry helps. Kick to medium loop.

The orchestrator derives the appropriate strategy from `touches` metadata: if the failed task's write set is disjoint from all downstream read sets, isolated retry is safe. If not, cascade or escalate. This is a mechanical decision, not a judgment call.
