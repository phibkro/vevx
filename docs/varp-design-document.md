# Varp: A Reactive Agent Orchestration Framework

*Design Document — v0.1.0 — February 2026*

---

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

Agents exhibit two distinct natures that map to different engineering traditions. Their *interface* is functional — you define what an agent does the same way you define a function. Their *runtime behavior* is process-like — they have lifecycles, accumulate state, consume resources, and fail in ways that need structured handling. Varp models both explicitly.

#### The Functional Interface (3D Model)

Agents are defined as functions with three dimensions plus input:

**Domain (invariant — precondition):** What the agent knows. "You are a senior TypeScript engineer." This constrains the space of competent behavior. It holds true across every invocation.

**Values (invariant — postcondition):** What the agent prioritizes. "Correctness over speed, maintainability over cleverness." This is a priority ordering that determines how the agent resolves tradeoffs. It doesn't change per task.

**Action (transformation):** What the agent does. Review, implement, research, plan. This defines the shape of output given input.

**Context (input — the only thing that varies):** The project state, relevant documentation, specific files, task requirements. This is the only dimension that changes between calls, and the only dimension that can be silently wrong.

Effective prompting often compresses multiple dimensions into a single phrase. "You are a senior engineer reviewing code for correctness" sets domain, values, and action simultaneously. This compressed form activates behavior more naturally than explicit declaration, but the dimensions are still there and can be varied independently.

**Saved prompts work best when action is static.** Fix the transformation, parameterize everything else. This is currying — partially apply the action, get back a reusable function that takes (domain, values, context) as arguments.

The 3D model governs how agents are *defined* and *dispatched*. The manifest and plan are the functional layer — declarative, compositional, concerned with what agents should do.

#### The Process Execution Model

Agents *execute* as processes. They have duration, accumulate state during execution, consume resources (tokens, time, API calls), can be suspended and resumed, and fail in ways more complex than "return or throw." A function either returns a value or raises an exception. A process can hang, leak resources, produce partial results, corrupt shared state, or fail silently.

This distinction has concrete architectural consequences:

**Lifecycle management.** Agents start, run, and terminate. The orchestrator must track their state: pending, running, completed, failed, cancelled. Warm agent resumption is process suspension and restart — the subagent's accumulated context is preserved across invocations, like a process swapped back into memory.

**Resource budgets.** Processes get resource limits (cgroups, ulimits). Agent tasks need token budgets, time limits, and iteration bounds. An agent that has burned 50k tokens without converging is probably stuck, not thorough. This is especially important for contract-mode tasks where the agent determines its own approach — unbounded autonomy with unbounded resources produces runaway costs. The orchestrator sets per-task budgets at dispatch time, scaled to task complexity and plan mode (directed tasks get tighter budgets than contract tasks).

**Failure modes.** The `COMPLETE|PARTIAL|BLOCKED|NEEDS_REPLAN` discriminated union is modeling process exit states, not function return types. `PARTIAL` means the process did useful work but couldn't finish — like a process killed by OOM that managed to flush some output. `BLOCKED` means it's waiting on an external condition. `NEEDS_REPLAN` means the task's assumptions were wrong — the process discovered its preconditions don't hold.

**Capability restrictions.** Processes run in namespaces with restricted views of system resources. Agent tasks should be similarly constrained: a subagent dispatched with `touches writes="auth" reads="api"` should only be able to modify files in auth's path and read files in api's path. `touches` declarations become capability grants, verified on commit (Section 3.4).

**Process accounting.** The system tracks per-task resource consumption: tokens used, tools invoked, files modified, time elapsed, verification pass/fail rate. This data feeds into `log.xml` as structured execution metrics, enabling slow-loop questions like "which component is most expensive to work on?" and "which task types have the highest failure rate?"

The orchestrator is the process manager — the scheduler, supervisor, and resource controller. It operates on the functional definitions (3D model, plans, manifests) but manages execution using process semantics.

This pattern is well-established: Erlang processes have functional interfaces but process semantics. Goroutines are launched with function calls but have thread-like lifecycles. OS threads start by passing a function pointer. The function defines *what*; the process defines *how it executes*.

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

- **Isolated retry:** The failed task's write set doesn't overlap with any completed task's read set in subsequent waves. Safe to retry — delete the worktree, redispatch. The nondeterminism concern is bounded: retry is unsafe if you need *identical* output, but valid if you're checking *postconditions*. A retry that produces different code but passes the same postconditions is a successful recovery. Contract-mode tasks are particularly retry-friendly.
- **Cascade restart:** The failed task's output is consumed by later tasks that have already been dispatched or completed. The failure invalidates downstream work. The orchestrator must cancel the affected wave (if in progress) and restart from the failed task forward.
- **Escalate to human:** The failure indicates a planning problem, not an execution problem — preconditions were wrong, the task was misscoped, or postconditions are unsatisfiable. No amount of retry helps. Kick to medium loop.

The orchestrator derives the appropriate strategy from `touches` metadata: if the failed task's write set is disjoint from all downstream read sets, isolated retry is safe. If not, cascade or escalate. This is a mechanical decision, not a judgment call.

## 3. Architecture

Varp has three components that evolve independently:

- The **component manifest** — declarative state of the system (what exists)
- The **plan** — declarative intent for change (what should happen)
- The **orchestrator** — adaptive execution engine (how it happens)

This separation mirrors proven systems architecture. The manifest is the database schema. The plan is the transaction. The orchestrator is the transaction manager and query planner. Each has a different rate of change: the manifest changes with project structure (slow), plans change with features (medium), and orchestrator strategy can change per-session (fast). Matching rate of change to separation boundary is what makes the system maintainable.

### 3.1 Component Manifest

The manifest is a YAML file that maps the project's module structure. It is the persistent, human-maintained source of truth about what exists and where it's documented.

```yaml
varp: 0.1.0
name: my-project

components:
  auth:
    path: ./src/auth
    docs:
      interface: ./docs/auth/interface.md
      internal: ./docs/auth/internal.md

  api:
    path: ./src/api
    depends_on: [auth]
    docs:
      interface: ./docs/api/interface.md
      internal: ./docs/api/internal.md

  web:
    path: ./src/web
    depends_on: [auth, api]
    docs:
      interface: ./docs/web/interface.md
      internal: ./docs/web/internal.md
```

**Interface docs** describe how to use the component from outside — its API surface, behavioral assumptions, and the guarantees callers can rely on. These are loaded when a task depends on this component.

**Internal docs** describe how the component works inside — implementation details, design decisions, and local conventions. These are loaded only when a task directly modifies this component.

**Dependencies** declare the static relationship between components. `web` depends on `auth` and `api`, meaning it consumes their interfaces. This serves two purposes: the planner agent uses it to understand the project's dependency graph when decomposing features, and the framework uses it for cross-session invalidation — when `auth`'s interface docs change, any component that depends on `auth` is flagged for review even if no plan is currently active.

Task-level `touches` declarations are the per-operation subset of these static dependencies. A task on `web` that reads from `auth` is consistent with `web`'s `depends_on: [auth]`, but not every task on `web` will touch every dependency. The manifest captures the structural truth; `touches` captures the operational specifics.

**Varp tracks architectural dependencies, not package dependencies.** `depends_on` captures behavioral relationships between components — "web consumes auth's interface and assumes certain behaviors." Package-level dependencies (shared libraries, framework versions, transitive npm dependencies) are deferred to existing tooling. Monorepo tools like Turborepo, pnpm workspaces, and nx already maintain the package dependency graph, resolve transitive dependencies, and can report impact radius when shared dependencies change. The orchestrator and planner agent should query these tools (e.g., `turbo ls --affected`, `pnpm why react`) when planning work that involves shared dependency upgrades, rather than maintaining a parallel dependency graph in the manifest.

When the orchestrator dispatches a task that `writes` to `auth` and `reads` from `api`, it loads `auth`'s internal docs and `api`'s interface docs. Exactly the right information, no more. The plan references components by name, the manifest resolves names to file paths and documentation.

**The interface doc IS the contract.** There is no separate contract artifact. A component's `interface.md` describes its API surface, behavioral assumptions ("this module assumes the request has already been authenticated"), ordering guarantees, and what it explicitly does not guarantee. This is the single source of truth for how other components and agents should interact with it.

Some of this content can be autogenerated (type exports, route definitions), but the behavioral assumptions that actually break agent work must be written by humans, because no tool can extract semantic expectations from code. The interface doc is where both live, in whatever mix is appropriate for the component.

### 3.2 Plan Format

Plans are XML files that declare what should change. They are produced by a **planner agent** — a specialized agent whose domain is decomposing vague human intent into concrete, verifiable plans. The human describes what they want ("add rate limiting to auth endpoints"), the planner asks clarifying questions ("per-user or per-IP? what's the threshold? what HTTP status on limit?"), and produces a plan with Hoare Logic contracts that the orchestrator can execute autonomously.

The planner and orchestrator never run simultaneously. The planner session is a conversation between human and planning agent that produces `plan.xml` as its artifact. The orchestrator session picks up that artifact and executes it. They communicate through the plan file, not through shared context.

```xml
<plan>
  <metadata>
    <feature>Rate Limiting</feature>
    <created>2026-02-16</created>
  </metadata>

  <contract>
    <preconditions>
      <condition id="pre-1">
        <description>Auth module has endpoint handlers</description>
        <verify>grep -r "router\." src/auth/routes.ts</verify>
      </condition>
    </preconditions>

    <invariants>
      <invariant critical="true">
        <description>Existing auth tests pass throughout</description>
        <verify>npm test -- --filter=auth</verify>
      </invariant>
    </invariants>

    <postconditions>
      <condition id="post-1">
        <description>Rate limiting active on all auth endpoints</description>
        <verify>npm test -- --filter=rate-limit</verify>
      </condition>
      <condition id="post-2">
        <description>Rate limit returns 429 after threshold</description>
        <verify>curl -s -o /dev/null -w "%{http_code}" localhost:3000/auth/login | grep 429</verify>
      </condition>
    </postconditions>
  </contract>

  <tasks>
    <task id="1">
      <description>Implement rate limiting middleware</description>
      <action>implement</action>
      <values>security, correctness, backwards-compatibility</values>
      <touches writes="auth" reads="api" />
      <budget tokens="30000" minutes="10" />
    </task>

    <task id="2">
      <description>Add rate limit integration tests</description>
      <action>test</action>
      <values>coverage, correctness</values>
      <touches writes="auth" reads="auth" />
      <budget tokens="20000" minutes="8" />
    </task>

    <task id="3">
      <description>Update API documentation</description>
      <action>document</action>
      <values>accuracy, completeness</values>
      <touches reads="auth, api" />
      <budget tokens="10000" minutes="5" />
    </task>
  </tasks>
</plan>
```

**The plan does not specify execution order.** Tasks declare their read and write sets via `touches`. The orchestrator derives execution order at runtime by analyzing data dependencies. This separation means plans can be written by a planner agent (or human) without needing to reason about scheduling, and the orchestrator can optimize execution independently.

**Two plan modes coexist within the same schema:**

- **Directed plans** include explicit action steps within tasks. The agent follows them. Appropriate for simpler, well-understood work.
- **Contract plans** include only postconditions. The agent determines its own path to satisfaction. Appropriate for complex autonomous work.

**Why XML:** Reliable agent parsing, clear nesting for structured data (tasks within plans, conditions within contracts), and schema validation. Markdown is preferred for narrative documentation; XML is preferred for machine-consumed control structures.

**Verification commands must be idempotent and exit-code-based.** Each `<verify>` element is a shell command that exits 0 on success and non-zero on failure. Tests are preferred over greps — `npm test --filter=auth` is a reliable postcondition; `grep -r "router\."` is fragile. The plan example above uses grep for illustration; real plans should prefer test suites, type checks, and assertion scripts.

**Resource budgets are per-task.** Each task declares token and time limits that the orchestrator enforces during execution. Directed tasks get tighter budgets (the path is known). Contract tasks get more headroom (the agent must discover its own approach). The planner sets initial budgets based on task complexity; the orchestrator can adjust based on execution history from previous waves or sessions.

### 3.2.1 The Planner Agent

The planner agent is a specialized agent whose domain is decomposing vague human intent into concrete, verifiable plans. It runs in a dedicated session — a conversation between human and planner — and produces `plan.xml` as its artifact.

**Planner protocol:**

1. **Load manifest** — read `varp.yaml` to understand component structure and dependency graph
2. **Clarify intent** — ask the human targeted questions to resolve ambiguity ("per-user or per-IP? what HTTP status on limit?")
3. **Decompose** — break the feature into tasks scoped to individual components
4. **Derive `touches`** — for each task, determine which components it reads from and writes to, cross-referencing the manifest's `depends_on` graph for consistency
5. **Set budgets** — assign token and time limits per task, scaled to complexity and plan mode
6. **Write contracts** — produce preconditions (what must be true before work starts), invariants (what must remain true throughout), and postconditions (what must be true when done) with concrete verification commands
7. **Choose plan mode** — directed (explicit steps) for well-understood work, contract (postconditions only) for complex autonomous work
8. **Output `plan.xml`** — the complete plan artifact

**`touches` validation is the planner's responsibility.** The entire concurrency model depends on correct read/write declarations. The planner derives `touches` from both the task description and the manifest's dependency graph. If a task on `web` needs to change behavior that flows through `auth`, that's a write to `auth`, not just `web` — even if the files being edited are in `web`'s directory. The planner must reason about behavioral dependencies, not just file locations.

The orchestrator performs a consistency check at dispatch time: if a task's `touches` references a component not in the manifest, or if a write target isn't reachable through `depends_on`, execution halts and kicks back to replanning. This catches the most obvious errors but cannot catch undeclared dependencies — those surface as postcondition failures after execution.

### 3.3 File Structure

Plans are organized by lifecycle status using the filesystem as source of truth:

```
project/
  varp.yaml                    # component manifest (persistent)
  docs/
    auth/
      interface.md             # API surface and behavioral assumptions
      internal.md              # implementation details
    api/
      interface.md
      internal.md
  plans/
    in-progress/
      rate-limiting/           # the active feature (only one)
        plan.xml               # planner agent output (immutable during execution)
        log.xml                # orchestrator output
    in-review/
      auth-refactor/
        plan.xml
        log.xml
    backlog/
      dark-mode/
        plan.xml
    blocked/
      payment-integration/
        plan.xml
        log.xml
    done/
      initial-setup/
        plan.xml
        log.xml
```

**One feature at a time (v0.1 simplification).** Only one plan may exist in `in-progress`. The orchestrator has a single plan loaded, full focus, no context switching. Parallelism lives within the plan (concurrent tasks on independent components), not across plans. This is a deliberate constraint for the initial version — cross-plan parallelism introduces inter-plan dependency analysis that can be designed later if single-plan execution proves too limiting.

**Status transitions are filesystem operations.** Moving a plan from `in-progress` to `in-review` is `mv plans/in-progress/rate-limiting plans/in-review/rate-limiting`. No metadata to update, no index to sync. The filesystem is the source of truth.

**The human is the feature-level scheduler.** The human picks the next feature from the backlog, works with the planner agent to produce (or refine) a plan, moves it to `in-progress`, and kicks off an execution session. The orchestrator is the task-level scheduler within that feature. This division gives humans control over strategic sequencing while delegating both planning and execution to specialized agents.

**`log.xml` is the orchestrator's execution record.** While `plan.xml` is immutable during execution, `log.xml` is the orchestrator's running output — the raw material for the medium loop. It records: which tasks were dispatched and in what order, which postconditions passed or failed, which docs were invalidated, which components were flagged as uncertain, orchestrator observations passed between waves, per-task resource consumption (tokens, time, tool invocations), and restart decisions with rationale. The log, diffed against the plan's expected outcomes, is what the human reviews between sessions.

### 3.4 The Orchestrator

The orchestrator is Claude Code — specifically, a Claude Code session with Varp's MCP tools and skills loaded. It is both coordinator and process manager: it maintains the accurate project model, translates architectural intent into concrete subagent prompts, schedules and supervises task execution, enforces resource budgets, handles failures, and executes the plan's task graph.

Varp does not implement its own orchestrator runtime. Claude Code already provides the agent loop, tool execution, subagent dispatch (Task tool), session management, hooks system, and context compaction. Varp adds manifest-awareness to this existing infrastructure through MCP tools that the orchestrator calls during its work cycle.

**Enforced chain of thought:** The orchestrator follows a rigid protocol for each work cycle:

1. **Select** — pick the next executable task(s) from the dependency graph, prioritizing critical path tasks (those that block the most downstream work)
2. **Verify** — check preconditions and context freshness (via `varp_check_freshness`)
3. **Load** — resolve component references via manifest, inject appropriate docs (via `varp_resolve_docs`)
4. **Budget** — set resource limits for the task based on plan budgets and execution history
5. **Dispatch** — send task to subagent with assembled context and capability grants (via Claude Code's Task tool)
6. **Monitor** — track resource consumption against budget; flag tasks approaching limits
7. **Collect** — receive structured result (`COMPLETE|PARTIAL|BLOCKED|NEEDS_REPLAN`)
8. **Verify capabilities** — confirm actual file changes match declared `touches` (via `varp_verify_capabilities`)
9. **Review** — verify task output against postconditions and invariants
10. **Handle failure** — if task failed, derive restart strategy from `touches` graph (isolated retry, cascade restart, or escalate)
11. **Observe** — extract observations from completed tasks to enrich context for subsequent dispatches
12. **Update** — refresh documentation for modified components
13. **Invalidate** — cascade changes to dependent contexts (via `varp_invalidation_cascade`)
14. **Advance** — mark task complete, unblock dependent tasks

**Wave cancellation.** If a critical invariant fails during a wave (checked between task completions), the orchestrator signals all running subagents in the wave to stop. Graceful cancellation lets subagents finish their current atomic operation and return partial results. Hard cancellation abandons worktrees and discards everything. The orchestrator chooses based on invariant severity: `critical="true"` invariants trigger hard cancellation; others allow graceful wind-down.

**Capability enforcement.** `touches` declarations are not just scheduling hints — they are capability grants. After a subagent completes, the orchestrator verifies that actual file modifications fall within the declared write set by checking the git diff against component path boundaries from the manifest. A subagent dispatched with `touches writes="auth"` that modified files in `web/`'s path has violated its capabilities. This is caught before merge, not after — the worktree is quarantined and the task either retried with corrected scope or escalated to replanning.

**The orchestrator owns prompting knowledge.** It is given the prompting research and framework as T1 knowledge because effective prompt construction IS its domain expertise. It assembles subagent prompts by combining the task's action and values with the component's domain context and relevant documentation — applying the 3D model at dispatch time.

**Subagents are processes with functional interfaces.** They are *defined* functionally — domain, values, action, context — but *execute* as processes with lifecycles, resource consumption, and structured exit states. They receive fully assembled context, perform a narrow transformation, and return a structured result. They don't load their own context, don't know about other agents, and don't manage state beyond their current session.

"Warm agents" are resumed subagent sessions — when a later task operates on the same component scope, the orchestrator can resume the previous subagent's session rather than starting cold, preserving the subagent's accumulated context about that component. This is analogous to fork-and-COW: the new task starts with the previous subagent's component knowledge (shared pages), then diverges only where the new work requires it (copy-on-write). This is distinct from orchestrator session persistence: the orchestrator session lives across the whole plan, while subagent sessions are per-component and optionally resumed.

### 3.5 Delivery: Claude Code Plugin

Varp is delivered as a Claude Code plugin, not a standalone CLI. The plugin provides three integration layers:

**MCP tools (core logic):** Deterministic functions exposed as MCP tools that the orchestrator calls during its work cycle. These handle manifest parsing, doc resolution, hazard detection, wave computation, invalidation cascading, capability verification, and resource tracking — the mechanical operations that should be code, not agent reasoning.

**Skills (workflow protocols):** Slash commands that load the appropriate protocol and context for each Varp workflow. Skills are reusable — they structure the agent's behavior for a session without persisting as permanent system prompts. When a skill is invoked, it loads its protocol; when the session ends, the protocol is unloaded. A normal Claude Code session has no Varp overhead.

- `/varp-plan` loads the planner protocol (Section 3.2.1) and the manifest, turning the Claude Code session into a planning conversation. The skill IS the planner's T1 knowledge — it provides the decomposition methodology, the `touches` derivation rules, budget-setting guidelines, and the contract-writing protocol.
- `/varp-execute` loads the orchestrator protocol (Section 3.4) and the active plan from `plans/in-progress/`, turning the session into an execution run. The skill provides the 14-step chain of thought, the dispatch rules, restart strategies, capability enforcement protocol, and the verification protocol. The manifest and plan together form the orchestrator's T1 knowledge for that session.
- `/varp-review` surfaces the medium loop decision surface — the log.xml diffed against the plan's expected outcomes, with doc freshness status, invalidation flags, and execution metrics (resource consumption, failure rates, restart decisions).
- `/varp-status` reports project state: component registry, doc freshness, plan lifecycle status, dependency graph health.

The tiered knowledge architecture is implemented through skill loading, not through persistent configuration. Each skill loads exactly the T1 context its workflow needs. T2 knowledge (component docs) is loaded dynamically by MCP tools during execution, resolved from manifest references.

**Hooks (enforcement):** Lifecycle hooks that enforce Varp conventions during active Varp sessions. `SubagentStart` auto-injects relevant component docs based on the orchestrator's resolved context for the current task. `PostToolUse` flags docs for refresh after file writes. `SessionStart` loads the manifest and displays project state when a Varp skill is invoked.

**Why not a standalone CLI:** Claude Code already provides the REPL, tool execution, subagent dispatch, session management, streaming, permissions, and context compaction. Reimplementing these would be wasted effort. Varp's value is manifest-aware context management — the data structures and logic that make agent orchestration dependency-aware. Packaging this as a plugin delivers that value without duplicating infrastructure.

**Prompt caching integration:** The Anthropic SDK's prompt caching (90% cost reduction on cache reads) maps naturally to Varp's tiered knowledge. T1 knowledge (manifest + skill protocol) is cached at the system prompt level — stable across all dispatches within a session. T2 knowledge (component docs) is cached per component scope — reused across tasks that share the same component context. Cache breakpoints are placed at tier boundaries: tools → system (T1) → component docs (T2) → task-specific context.

## 4. Concurrency Model

### 4.1 The DBMS Analogy

Varp's concurrency model borrows directly from database management systems because it solves the same fundamental problem: multiple actors changing shared state safely.

| DBMS Concept | Varp Equivalent |
|---|---|
| Schema | Component manifest |
| Transaction | Plan (set of tasks) |
| Transaction manager | Orchestrator |
| MVCC / Write-ahead log | Git branches and worktrees |
| Materialized views | Component documentation (interface + internal) |
| Constraint checking | Postcondition verification |
| View maintenance | Invalidation cascade |

The critical insight is that Varp doesn't care what your software project *does*, just as a DBMS doesn't care what data *means*. Varp manages component structure, documentation consistency, and work concurrency generically. The domain knowledge lives in the plans and docs, not in the framework.

### 4.2 Data Hazards

Tasks that operate on shared components create the same data hazards as concurrent memory operations in CPU pipelines:

**RAW (Read After Write) — true dependency.** Task B reads a component that Task A writes. Task B must wait for Task A to complete. This is the only hard scheduling constraint.

**WAR (Write After Read) — anti-dependency.** Task A reads a component that Task B writes. If Task B runs first, Task A reads the wrong state. Resolved by context snapshotting: the orchestrator captures component documentation at dispatch time, so the reader's context is frozen regardless of subsequent writes. This is register renaming.

**WAW (Write After Write) — output dependency.** Tasks A and B both write to the same component. The last writer wins, so order matters. This is either a scheduling constraint or a plan design smell — two tasks writing the same component usually indicates they should be merged or sequenced intentionally.

### 4.3 Git as MVCC

Git worktrees implement multiversion concurrency control naturally:

**Each parallel task gets its own worktree** branched from the same commit (HEAD). This is snapshot isolation — each task sees a consistent view of the codebase as it existed when the task started.

**WAR is resolved automatically.** The reader's worktree contains the pre-write state. No coordination needed between concurrent readers and writers.

**Merge is the commit operation.** When tasks complete, the orchestrator merges their worktrees back to main. Merge order follows dependency constraints (RAW targets first).

**Merge conflicts are runtime WAW detection.** If two tasks modified the same files, git reports exactly where. This is conflict detection that's both free and more precise than any hand-written checker.

**Rollback is trivial.** If a task fails, delete its worktree. Main is untouched. This is transaction abort with zero cost.

### 4.4 Pessimistic Scheduling, Optimistic Execution

The concurrency control strategy is a hybrid informed by the specific cost structure of agent work:

**Agent transactions are expensive to abort.** A failed task may represent minutes of work and thousands of tokens. Unlike database transactions that can be cheaply retried, agent tasks are nondeterministic — re-running doesn't guarantee the same result.

**Conflicts are preventable at planning time.** The `touches` metadata on each task declares read and write sets upfront. The orchestrator can analyze all hazards before dispatching any work.

Therefore: **prevent conflicts at scheduling time (pessimistic), execute freely within worktrees (optimistic).**

The orchestrator analyzes the task graph's `touches` declarations, identifies RAW/WAR/WAW hazards, and groups tasks into execution waves where no two concurrent tasks write to the same component. Within a wave, each task runs in its own worktree without interference. Between waves, the orchestrator merges results, verifies invariants, and dispatches the next wave.

**Critical path scheduling.** Not all tasks are equally urgent. Tasks on the critical path — those whose completion unblocks the most downstream work — are prioritized within each wave. The critical path is derivable from the dependency graph: it's the longest chain of RAW dependencies from any root task to any leaf task. The orchestrator computes this at plan load time and uses it to prioritize dispatch order when multiple tasks are eligible.

This avoids the failure mode that led TiDB to abandon pure optimistic concurrency control: expensive rollbacks under contention. By preventing write-write conflicts structurally, the orchestrator never discovers a conflict after the expensive work is already done.

### 4.5 Verification as Serialization Check

Snapshot isolation has a known weakness: write skew. Two tasks can read overlapping state, make individually valid but collectively inconsistent changes to disjoint components, and both succeed. Git merges cleanly because the changes don't overlap textually, but they may conflict semantically.

Postcondition verification on the merged result is the serialization check. After all tasks in a wave complete and merge, the orchestrator runs invariant checks and postconditions on the integrated state. If these fail, the human reviews the conflict — automatic retry is not appropriate because agent tasks are nondeterministic.

This is equivalent to Serializable Snapshot Isolation (SSI) in PostgreSQL, but with human-in-the-loop conflict resolution instead of automatic transaction abort.

## 5. Feedback Loops

Varp operates across three timescales:

### 5.1 Fast Loop (Within Session)

The orchestrator's inner execution cycle: select → verify → load → budget → dispatch → monitor → collect → verify capabilities → review → handle failure → observe → update → invalidate → advance. Fully autonomous within the bounds of the plan's contracts and the orchestrator's restart strategy. The orchestrator makes all decisions it can derive mechanically from `touches` and postconditions, and escalates everything else to the human.

### 5.2 Medium Loop (Across Sessions)

Plan → execute → observe → replan. The human reviews the **manifest diff** between pre-execution and post-execution state: which tasks completed, which failed, which docs were invalidated, which interfaces broke, what the orchestrator flagged as uncertain.

The execution metrics from `log.xml` inform the next cycle: tasks that consumed disproportionate resources suggest misscoped work, high restart rates on a component suggest inadequate interface documentation, capability violations suggest incorrect `touches` derivation by the planner. These signals feed back into planning — the planner can use execution history to set better budgets, write tighter `touches`, and decompose more carefully.

This annotated diff is the decision surface. The human decides whether to proceed, replan, or intervene. The planner agent (a separate session, never running simultaneously with the orchestrator) produces or refines the next plan based on the current state, guided by the human's intent.

**This is where 90% of the system's value lives.** The medium loop is what prevents the system from drifting — each cycle recalibrates based on actual results rather than assumptions.

### 5.3 Slow Loop (Over Time)

The framework itself evolving. T1 principles update as patterns emerge across many execution cycles. The manifest grows as the project adds components. Plan templates improve as failure modes are discovered. The orchestrator's strategy becomes more sophisticated. Aggregate execution metrics across many plans reveal which components are expensive, which task types fail often, and where the documentation investment has the highest return.

## 6. Documentation as System State

Documentation rot actively degrades agent performance because agents trust context literally. A stale doc isn't just unhelpful — it's actively harmful, producing confident but wrong behavior.

Varp treats documentation as a first-class concern in the work cycle:

**Every task that writes to a component triggers a doc update step.** The orchestrator's post-work protocol includes refreshing documentation for any component in the task's write set.

**Invalidation cascades through dependencies.** When component A's interface docs change, the manifest's `depends_on` graph identifies every component that consumes A's interface. During active execution, the `touches` metadata enables targeted refresh — only tasks that actually read from A need updated context. Between sessions, the manifest-level dependencies flag stale assumptions for the next planning cycle, even without an active plan.

**Interface and internal docs serve different audiences.** Interface docs describe how to use a component — loaded by tasks that depend on it. Internal docs describe how it works — loaded only by tasks that modify it. This distinction prevents information overload while ensuring each task has exactly the context it needs.

## 7. Open Questions

### 7.1 Medium Loop Interface

The medium loop is underspecified. The manifest diff concept is clear in principle, but the concrete UX — what the human sees, what decisions they can make, how replanning integrates with the existing plan — needs design work. This is the most important open problem because the medium loop is where system value concentrates.

### 7.2 Semantic Conflicts

Git detects structural merge conflicts (same lines changed). Two agents can make semantically incompatible changes to different files that git merges cleanly. The postcondition and invariant checks catch some of these, but they only test what was explicitly contracted. Uncontracted semantic conflicts — changes that are individually correct but collectively wrong in ways nobody anticipated — remain a gap.

### 7.3 Decision Authority

When does the orchestrator proceed autonomously vs. ask the human? The restart strategies (Section 2.4) handle failure cases mechanically, but gray areas remain: a task that completes with `PARTIAL` status, a postcondition that passes but with warnings, a capability violation that looks like a `touches` derivation error rather than agent misbehavior. A decision authority matrix that encodes escalation thresholds should be a framework-level concept. The exact thresholds need empirical tuning through real usage.

### 7.4 `touches` Accuracy

The concurrency model is only as good as the `touches` declarations. If a task declares `reads: auth` but actually modifies auth's behavior through a shared utility or transitive dependency, the hazard detection misses it. Capability verification (Section 3.4) catches *writes* to undeclared components after the fact, but undeclared *reads* — where a task depends on a component's behavior without declaring it — remain invisible until postcondition failures reveal the gap. Whether additional static analysis (e.g., scanning file-level imports to infer component boundaries) can improve `touches` accuracy without adding brittleness is worth investigating.

### 7.5 Interface Completeness

The behavioral assumptions in interface docs are human-written because the important ones can't be mechanically extracted. But how do you know you've documented all the important assumptions? Missing interface assumptions are the most dangerous failure mode — the system has no way to verify what it doesn't know about. This is fundamentally unsolvable in general, but heuristics for surfacing likely-missing assumptions (e.g., components that interact frequently but have sparse interface docs, or high capability-violation rates on a component boundary) could help.

### 7.6 Budget Calibration

Initial resource budgets are set by the planner based on task complexity estimates, but these estimates may be systematically wrong — especially early in a project's lifecycle when there's no execution history. The orchestrator can adjust budgets based on observed consumption patterns, but the feedback loop between observed costs and planned budgets crosses the session boundary. How budget learning feeds from `log.xml` back into planning, and whether the planner should have access to aggregate execution metrics, needs design work.

### 7.7 Warm Agent Staleness

Resuming a subagent session preserves its accumulated context, but that context may be stale if other tasks have modified components in its scope since the session was suspended. The orchestrator checks doc freshness before dispatch, but a warm agent's *implicit* understanding (patterns it noticed, assumptions it formed) can't be freshness-checked. Whether warm agent resumption should be limited to cases where no intervening writes occurred, or whether a freshness summary injected at resumption is sufficient, is an open question.

## 8. Relationship to Existing Work

### 8.1 What Varp Borrows

**Tiered memory architectures** (MemGPT, Letta): The T1/T2/T3 knowledge hierarchy is a direct application of tiered memory management to agent context.

**MVCC and concurrency control** (PostgreSQL, Convex): Snapshot isolation via git worktrees, optimistic execution with pessimistic scheduling, postcondition verification as serialization checks.

**CPU pipeline theory:** RAW/WAR/WAW hazard detection for task scheduling, register renaming via context snapshotting, speculative execution via parallel worktrees.

**OS process management:** Resource limits (token/time budgets as cgroups), capability restrictions (`touches` as namespace boundaries), process accounting (structured execution metrics), wave cancellation (process group signals), fork-and-COW semantics (warm agent resumption).

**Erlang/OTP supervision trees:** Two-layer constraint as flat supervision hierarchy. Restart strategies (isolated retry, cascade restart, escalate) derived mechanically from dependency metadata rather than configured per-worker. The supervisor (orchestrator) has a global view; workers (subagents) are isolated.

**Orchestrator-worker patterns:** Centralized coordination with distributed execution. Well-established in both human organizations and distributed systems.

### 8.2 What's Novel

**The dual agent model.** Agents as processes with functional interfaces — defined by the 3D model (domain/action/values as function signature), executed with process semantics (lifecycle, resources, capabilities, failure handling). The functional layer governs definition and dispatch; the process layer governs execution and supervision.

**Static vs. dynamic as the fundamental architectural principle.** The claim that most agent failures trace to confusing invariant knowledge with volatile context, and that the entire framework follows from rigorously maintaining this distinction.

**`touches` as unified scheduling and capability mechanism.** Read/write declarations serving triple duty: concurrency hazard detection (scheduling), capability grants (enforcement), and restart strategy derivation (failure handling). One declaration, three enforcement layers.

**Documentation lifecycle as a first-class concern.** Treating docs not as artifacts but as system state that must be maintained with the same rigor as code, with dependency-aware invalidation cascading through the component graph. The interface/internal distinction as the mechanism for automatic context resolution.

**Planner-orchestrator session separation.** Planning and execution as distinct sessions communicating through plan artifacts, with the planner agent specializing in turning vague human intent into verifiable, actionable plans through clarifying dialogue.

**The DBMS framing applied to software project management by AI agents.** The systematic mapping of manifest→schema, plan→transaction, orchestrator→transaction manager, git→MVCC, docs→materialized views, verification→constraint checking — extended with process management semantics for the execution layer.

## 9. Implementation Path

### 9.1 Immediate Next Steps

1. **Build the MCP server.** TypeScript MCP server exposing core functions: manifest parsing, doc resolution, wave computation, hazard detection, invalidation cascade, freshness checking, plan validation, capability verification, resource tracking. Test against Varp's own `varp.yaml`.

2. **Write the skills.** `/varp-plan` and `/varp-execute` as Claude Code skills that load the planner and orchestrator protocols respectively. Each skill provides the T1 knowledge for its workflow — loaded on invocation, unloaded on session end.

3. **Wire the hooks.** `SubagentStart` for automatic doc injection (reading the orchestrator's resolved context, not re-deriving it), `PostToolUse` for freshness tracking, `SessionStart` for manifest loading when a Varp skill is active.

4. **Plan one feature end-to-end.** Use `/varp-plan` to produce a plan, `/varp-execute` to run it, `/varp-review` to inspect results. Validate the full cycle on a real project.

### 9.2 Build Sequence

1. **MCP server with manifest tools** — parse `varp.yaml`, resolve docs for tasks, compute invalidation cascades, check freshness
2. **MCP server with scheduler tools** — compute waves from `touches`, detect hazards, compute critical path
3. **MCP server with plan tools** — parse `plan.xml`, validate against manifest, validate budgets
4. **MCP server with enforcement tools** — capability verification (diff vs `touches`), resource tracking
5. **Skills** — `/varp-plan`, `/varp-execute`, `/varp-review`, `/varp-status` as reusable workflow protocols
6. **Hooks** — automatic doc injection, freshness tracking, session context
7. **Plugin packaging** — bundle MCP server + skills + hooks as a Claude Code plugin
8. **One end-to-end workflow** — full cycle on a real project
9. **Git worktree integration** — parallel task execution with automated merge and capability verification

### 9.3 Technical Choices

**TypeScript MCP server.** The MCP SDK handles JSON-RPC serialization, capability negotiation, and transport. Varp implements tool logic only. Runs in-process within the Claude Code plugin.

**YAML for the manifest, XML for plans.** YAML is human-maintained and human-readable. XML is agent-consumed and structurally validated. Markdown for narrative documentation.

**Structured outputs via Anthropic SDK.** Subagent results use JSON schema enforcement (`strict: true` on tool use) rather than hoping for well-formed XML. The `COMPLETE|PARTIAL|BLOCKED|NEEDS_REPLAN` discriminated union is enforced at the API level, not by convention.

**Prompt caching for cost efficiency.** Cache T1 knowledge (manifest, skill protocol) at the system prompt level. Cache T2 knowledge (component docs) per scope. Token counting before dispatch to stay within rate limits. Batch API (50% discount) for bulk postcondition verification.

---

## Appendix A: Naming

**Varp** is Norwegian for "warp" — the vertical threads in weaving that provide the structural foundation everything else weaves through. Domain and values are the warp: static invariants that hold the system together. Dynamic context is the weft, passing through on every invocation. Short, typeable, available as a package name, and a meaningful metaphor that maps precisely to the architecture.