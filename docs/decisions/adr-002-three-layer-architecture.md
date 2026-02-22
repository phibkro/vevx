# ADR-002: Three-Layer Architecture Separation

**Status:** Accepted
**Date:** 2026-02-19
**Deciders:** @phibkro

## Context

Varp currently packages codebase analysis (manifest parsing, import scanning, dependency graphs, freshness tracking) alongside agent orchestration (plans, wave scheduling, hazard detection, capability enforcement) and execution concerns (chunking, token estimation, model calling) within two packages: `@vevx/varp` and `@vevx/audit`.

This worked for initial development — the scheduler needs analysis, so they shipped together. But the coupling creates three problems:

1. **The analysis layer is independently valuable.** A developer who wants coupling diagnostics or dependency graph visualization doesn't need task scheduling. Entangling them means the analysis tools carry unnecessary conceptual weight and dependencies.

2. **The scheduling layer is executor-agnostic.** Wave scheduling, hazard detection, and restart strategies operate on abstract task graphs. They don't care whether the executor is an LLM, a human, a CI pipeline, or a script. But the current packaging assumes Claude Code as the executor, embedding that assumption into what should be generic infrastructure.

3. **Execution concerns leak upward.** Chunking, token estimation, and prompt construction are adapter concerns specific to LLM execution. They currently live in the audit package but conceptually belong with the executor, not the domain logic. A human executor wouldn't need chunking; a different LLM might need different token estimation.

The introduction of relational architecture analysis (co-change parsing, coupling diagnostics) makes the separation more pressing. These are pure analysis tools with no AI dependency — they should be usable without importing anything related to agents, tokens, or scheduling.

## Decision

Separate varp into three architectural layers with well-defined interface contracts between them. Each layer is a compiler stage: it accepts a defined input shape, transforms it, and produces a defined output shape.

### Layer 1: Analysis (codebase → enriched graph)

Understand the codebase. Pure functions over files and git history. No AI, no tokens, no scheduling.

Contains two internal phases (see The Compiler Analogy):

- **Parsing:** Manifest parsing, import scanning, git log walking, file enumeration → raw `CodebaseGraph`
- **Analysis passes:** Co-change weighting, hotspot scoring, complexity trends, coupling diagnostics, component inference → enriched `CodebaseGraph`

**Produces:** A `CodebaseGraph` — nodes with properties (hotspot score, complexity trend, component membership) and edges with independent signal weights (structural, behavioral, semantic). The graph shape is the same before and after analysis passes; passes enrich it without restructuring it.

**Contract:** Anything that can produce the `CodebaseGraph` shape can be an analysis source. Custom static analysis tools, framework-specific scanners, or third-party integrations all compose if they produce the right shape.

### Layer 2: Scheduler (tasks → waves)

Schedule work safely. Pure functions over task graphs. No opinions about who does the work or how it's consumed.

**Owns:** Plans, hazard detection (RAW/WAR/WAW/MUTEX), wave scheduling, critical path computation, capability enforcement, restart strategy derivation.

**Consumes:** `TaskDefinition[]` — tasks with `touches` declarations and optional `mutexes`.

**Produces:** `Wave[]` — where each `Wave` is a set of tasks safe to execute concurrently. The outer sequence is the dependency ordering between waves; the inner set is the parallelism within a wave.

This is the same structure regardless of consumer. For **agent consumption**, waves are streamed lazily — the next wave emits when the current one completes, with backpressure. For **human consumption**, the full `Wave[]` is materialized as a task list with dependency edges (a project plan, a checklist, a kanban board). The difference is evaluation strategy — eager vs lazy — not data shape.

**Contract:** Anything that can describe work in terms of read/write scopes gets safe scheduling. The executor identity is irrelevant — LLM agents, human developers, CI pipelines, shell scripts, or Slack messages that ping a developer and wait for a response.

### Layer 3: Execution (task → side effects)

Actually do things. This is where executor-specific concerns live.

**Owns:** Chunking, token estimation, prompt construction, model selection, model calling, context window management, response parsing. For human executors: task assignment, notification, response collection.

**Consumes:** A dispatched task with resolved context and capability grants.

**Produces:** A structured result (`COMPLETE|PARTIAL|BLOCKED|NEEDS_REPLAN`) with execution metrics.

**Contract:** Anything that can accept a task and produce a result fits. Each executor type is an adapter that bridges the scheduler's abstract task to a concrete execution mechanism.

### Interface Contracts

The layers compose through schemas, not through shared code:

```
                         ┌─────────────────────────────┐
                         │     Consumer (audit, CLI,    │
                         │     plugin, migrate, ...)    │
                         └──┬──────────┬──────────┬────┘
                            │          │          │
                         queries    submits    dispatches
                            │          │          │
                            ▼          ▼          ▼
                      Analysis    Scheduler    Execution
                            │          │          │
                      CodebaseGraph  Wave[]    TaskResult
```

The scheduler is a pure function: `TaskDefinition[] → Wave[]`. It has no knowledge of executors or analysis. The consumer bridges the layers — it queries analysis to understand what to work on, submits task definitions to the scheduler, and dispatches waves to an executor.

Domain packages (audit, migrate, document) are _consumers_ that compose all three layers. The layers don't depend on each other directly — the consumer is the composition point.

The Claude Code plugin becomes a thin adapter in the execution layer, not the core product.

## Consequences

**Positive:**

- Analysis tools become independently useful (coupling diagnostics without AI)
- Scheduler becomes executor-agnostic (same Wave[] output for humans, LLMs, or scripts — only the evaluation strategy differs)
- Execution concerns are isolated (different LLM adapters, human task assignment)
- Each layer is independently testable with pure functions (no mocks needed for analysis or scheduling)
- Third parties can extend any layer by conforming to the interface contracts
- The co-change analysis and coupling diagnostics have a clean home in the analysis layer

**Negative:**

- Package restructuring required (though the internal module boundaries already approximate this split)
- Interface contracts need careful design — too rigid and they limit extensibility, too loose and they don't guarantee composability
- Some current conveniences (e.g., tools that combine analysis + scheduling in one call) may need to be reimplemented as compositions

**Neutral:**

- The existing `varp.yaml` manifest format is unaffected — it's an analysis-layer concern
- The existing `plan.xml` format is unaffected — it's a scheduler-layer concern
- The MCP tool surface can remain the same externally while the internal organization shifts
- This is a packaging/architecture change, not a behavioral change — all existing functionality is preserved
- The analysis layer introduces a `.varp/` directory for cached derived state (incremental co-change graph). This requires gitignore conventions and has CI caching implications, but is scoped to the analysis layer.

## Implementation Path

This separation can be gradual. The internal module boundaries (`manifest/`, `scheduler/`, `enforcement/`) already approximate the split. The work is:

1. ~~Define the interface schemas (`CodebaseGraph`, `TaskDefinition`, `Wave`, `TaskResult`) as Zod schemas~~ **DONE** — `TaskDefinitionSchema` and `CodebaseGraphSchema` in `shared/types.ts`
2. ~~Ensure existing modules conform to layer boundaries (no analysis module importing scheduling concepts)~~ **DONE** — `buildCodebaseGraph()` in `analysis/graph.ts`, exposed via `varp_build_codebase_graph` MCP tool
3. ~~Extract chunking and token estimation from audit into an execution-layer module~~ **DONE** — `execution/chunker.ts` and `execution/types.ts` in core; audit re-exports from `@vevx/varp/lib`
4. ~~Define `TaskResult` schema and wire it through the execution layer~~ **DONE** — `TaskResultSchema` in `execution/types.ts`, `runWithConcurrency` in `execution/concurrency.ts`; audit migrated to use core's implementation

## Relationship to Existing Architecture

This refines rather than replaces the three-graph separation described in the architecture doc (§3.5):

| Existing Graph           | Layer     | Relationship                  |
| ------------------------ | --------- | ----------------------------- |
| Project graph (manifest) | Analysis  | The persistent codebase model |
| Task graph (plan)        | Scheduler | The work schedule             |
| Action graph (execution) | Execution | The concrete dispatch         |

The three-graph model described _what_ the graphs are. This ADR describes _where they live_ and _how they compose_.

## The Compiler Analogy

The system maps precisely to compiler architecture:

| Phase         | Compiler Analog       | Input → Output                |
| ------------- | --------------------- | ----------------------------- |
| **Parser**    | Lexer + Parser        | codebase → graph (DAG)        |
| **Analysis**  | Optimization passes   | graph → enriched graph        |
| **Scheduler** | Instruction selection | enriched graph + goal → waves |
| **Executor**  | Interpreter / Runtime | waves → side effects          |

The **analysis layer** (see Layer 1) contains two internal phases:

- **Parsing** produces the raw graph: import scanning, git log walking, file enumeration. These are pure transformations from unstructured input (files, git history) to structured representation. The output is a DAG of nodes and edges — structurally an AST of codebase relationships.

- **Analysis passes** enrich the graph without changing its shape: co-change weighting, hotspot scoring, complexity trends, diagnostic matrix computation, clustering. Like constant folding or dead code elimination in a compiler, these passes annotate the IR (adding edge weights, node properties, component memberships) but preserve the `CodebaseGraph` structure.

The parser has no dependency on analysis passes, but analysis passes depend on parser output. This is a clean internal dependency direction worth maintaining even though both phases live in the same layer and share the same `CodebaseGraph` type.

The interface contracts are the IR definitions between phases. This isn't metaphorical — it's the literal architecture of the system, and it explains why the layers compose: each phase's output is the next phase's input, with well-defined schemas at each boundary.

## Alternatives Considered

**Keep the current two-package split (core + audit).** Rejected because the analysis layer's independent value is being obscured, and the co-change analysis has no clean place to live without importing scheduling concepts.

**Split into many fine-grained packages immediately.** Rejected as premature. The architectural separation matters more than the package boundary. Internal module organization can enforce the layer boundaries without the overhead of managing many packages. Packages can split later when the interfaces stabilize.

**Make execution a plugin system from day one.** Considered but deferred. The executor interface should stabilize through concrete implementations (Claude Code adapter, CLI adapter) before being generalized into a plugin API. Premature abstraction here would likely produce the wrong interface.
