# Relational Architecture Analysis — Design Document

**Project:** varp (core extension)
**Status:** Draft v3
**Date:** February 2026

---

## Thesis: Insight Through Signal Combination

The deepest architectural insights come not from any single analysis, but from the _tension between independent views_ of the same system. Static analysis reveals structure. Semantic tagging captures intent. Git history exposes behavior. Each has different blind spots — and the interesting findings live exactly where these signals disagree.

This is triangulation applied to software architecture. A single signal tells you what _is_. Two signals, when they conflict, tell you what's _wrong_.

**Design principle:** Every analytical signal added to the system should have _different_ blind spots from existing signals. More of the same signal adds noise. An independent signal with complementary blind spots multiplies insight.

---

## Core Model

### The Weighted Graph

The system's internal representation is a single weighted graph:

- **Nodes** are files (or other addressable units)
- **Edges** carry weights from multiple independent sources
- **Components** are clusters within this graph, inferred or declared

All analysis — component detection, coupling diagnostics, drift detection — reduces to queries over this structure.

This is a category-theoretic framing: an object (file) is fully determined by its relationships to other objects, not by its internal structure. Two files with identical connection patterns are categorically equivalent — they play the same role in the system, regardless of content.

### Signal Layers

#### Layer 1: Structural (Static Import Analysis)

Parse import/require statements to build a directed dependency graph.

**Captures:** Potential coupling — what _can_ affect what.
**Blind spots:** Overcounts stable interfaces as coupling. Misses implicit dependencies through shared databases, APIs, or conventions. Cannot distinguish intentional from accidental coupling.

#### Layer 2: Behavioral (Git Co-Change Frequency)

For each commit, every pair of simultaneously changed files receives a weighted edge increase. The weight is inversely proportional to commit size, reflecting the intuition that a 2-file commit is a much stronger coupling signal than a 50-file commit:

```
weight per co-occurrence = 1 / (n - 1)    where n = files in commit

commit 1: [a.ts, b.ts, c.ts]  →  a↔b +0.5, a↔c +0.5, b↔c +0.5
commit 2: [a.ts, b.ts]        →  a↔b +1.0
commit 3: [c.ts, d.ts]        →  c↔d +1.0

Result: a↔b = 1.5, a↔c = 0.5, b↔c = 0.5, c↔d = 1.0
```

This graduated weighting avoids a binary atomic/non-atomic assumption about commit hygiene. Small, focused commits naturally dominate the signal; large commits contribute proportionally less.

**Single-file commits** produce no edges (there's no pair to connect). This is correct behavior — a single-file commit says nothing about coupling — but worth noting since single-file commits are common.

**Noise filtering:**

Primary filter: hard ceiling on commit size (e.g. 50 files). This does most of the work — it catches initial commits, large merges, bulk operations, and formatter runs regardless of commit message quality. The graduated weighting already down-weights moderately large commits; the ceiling catches the pathological cases.

Secondary filter: commit message pattern matching. Commits whose messages match common mechanical patterns (`chore:`, `format`, `lint`, `style`, `merge`, `rebase`, etc.) are skipped. This is a refinement, not a dependency — signal quality should hold even with inconsistent or meaningless commit messages, since the ceiling and graduated weighting handle most noise. Message filtering improves precision for teams that follow commit conventions.

File path exclude patterns (lockfiles, generated code, build artifacts) filter specific files from all commits regardless of commit size or message.

**File inclusion:** All files in the repo are included by default — not just source code. Config files, docs, migrations, CI definitions, and other non-source files carry legitimate coupling signal. A `Dockerfile` co-changing tightly with one service's source tells you something real about deployment coupling. A config file co-changing in a 2-file commit is genuinely strong signal; in a 30-file commit, the graduated weighting ensures it barely registers.

Default excludes are limited to purely mechanical files:

- Lockfiles (`bun.lock`, `package-lock.json`, etc.)
- Generated code (build artifacts, `.d.ts` outputs)
- The `.varp/` cache itself

**Captures:** Actual coupling — what _really_ changes together in practice.
**Blind spots:** Noisy for monorepo-style large commits. Cannot distinguish correlation from causation. No signal for code that hasn't changed recently.

**Temporal patterns (future):**

- File A consistently changes _before_ file B → directional dependency
- A cluster changes together but one file occasionally changes alone → likely the cluster's interface

#### Layer 3: Semantic (Tags and Declarations)

Human-authored annotations: tags, component declarations, architectural intent.

**Captures:** Intent — what things _mean_ and how they _should_ relate.
**Blind spots:** Manual, drifts from reality, incomplete. Reflects what developers _believe_ the architecture is, not necessarily what it _is_.

#### Future Layers (extensible)

Each should have independent blind spots from existing layers:

- **Type references:** Shared types without direct imports (structural, but orthogonal to import coupling)
- **Runtime call traces:** Actual execution paths (behavioral, but runtime vs commit-time)
- **Name prefix similarity:** Convention-based grouping (semantic, but automated)
- **Test co-location:** Test-to-subject mapping (intent signal, but implicit)

### The Coupling Diagnostic Matrix

The core analytical output. Combining any two signal layers reveals a diagnostic matrix. The most immediately useful combination is structural (imports) vs behavioral (co-change):

|                          | **High Co-Change**                  | **Low Co-Change**              |
| ------------------------ | ----------------------------------- | ------------------------------ |
| **High Import Coupling** | Explicit module — expected, healthy | Stable interface — good design |
| **Low Import Coupling**  | **Hidden coupling — investigate**   | Unrelated — expected           |

The **high co-change, low import coupling** quadrant is where the highest-value findings live. These are files coupled through implicit contracts (shared DB schemas, API boundaries, conventions) invisible to static analysis.

This matrix generalizes. Structural vs semantic: "the tags say these are separate concerns, but the graph says they're tightly coupled." Behavioral vs semantic: "you declared this a stable module, but it's churning." Each combination surfaces a different class of architectural insight.

---

## Component Model

### Tags Over Folders

Real architecture isn't hierarchical. A module can simultaneously be "part of the auth system," "a state machine," "a compiler pass," and "touches the database." The filesystem forces a single hierarchy. Tags represent the actual overlapping, compositional structure.

### Cross-Cutting File Declarations

Components can declare membership of files across any directory boundary. A "feature" in a real codebase spans route handlers, migrations, utilities, types, and tests. Components describe what's _actually_ a unit, not what the folder structure claims.

### Gradual Declaration

Following TypeScript's key design insight — gradual adoption with inference filling gaps:

1. **Fully inferred:** Zero configuration. Clustering algorithms (Louvain, spectral clustering) on the weighted graph identify natural groupings. The tool surfaces unnamed clusters: _"These 8 files are tightly coupled — what would you name their relationship?"_

2. **Partially declared:** Explicitly declare some components. Inference fills the rest. The tool flags disagreements: _"You declared these as one component, but they split into two disconnected subgraphs."_

3. **Fully declared:** Every file belongs to an explicit component. The tool validates declarations against the actual graph, surfacing architectural drift.

The interaction is **bottom-up discovery**: the code reveals its actual structure and the developer decides what to name it. This inverts the usual top-down architecture-then-implementation workflow.

---

## Architectural Validation

The most valuable output isn't visualization — it's the _gap between declared intent and observed reality_:

- "Your architecture claims to be X but the dependency graph reveals it's actually Y"
- "These files have no import relationship but always change together — hidden coupling"
- "This component's internal cohesion is weakening — files A and B are drifting apart"
- "You declared these as separate concerns, but they form a single tightly-coupled cluster"

Visualization serves this — not as a raw graph dump (which is useless at scale) but as a way to present the _semantic compression_: "these 40 files are one state machine" rather than 40 nodes and 200 edges.

---

## The Compiler Analogy

This system is itself a compiler:

- **Parse:** Extract raw signals (imports, git history, declarations)
- **Intermediate representation:** The unified weighted graph
- **Transform:** Clustering, diagnostic matrix analysis, drift detection
- **Emit:** Architectural insights, validation warnings, visualizations

This isn't decorative — it's the literal architecture of the tool. Each signal source is a parser. The weighted graph is the IR. Analysis passes are transformations. And the outputs are compiled from the combination of all inputs.

---

## Analysis Scope

The co-change analysis operates on the **entire git repository**, not just manifest-declared paths. The manifest serves as a presentation lens, not a scope boundary.

This is a deliberate choice: an undeclared file that shows high co-change with declared components is one of the most valuable findings — "you should probably know about this file." Scoping to declared paths would filter out exactly the surprises worth surfacing.

- **Analysis boundary:** The git repo (natural, well-defined)
- **Presentation boundary:** The manifest (components, tags, declared paths)
- **Interesting findings live at the gap:** Files outside the manifest that couple strongly to files inside it

---

## Signal Independence

Signal layers are kept as **separate dimensions**, not combined into a single weight. The diagnostic power of the coupling matrix comes from _disagreement_ between signals. Merging them into a single score destroys exactly what makes this useful.

Each query type combines signals differently:

- **Hidden coupling detection:** High behavioral, low structural → investigate
- **Architecture drift:** High behavioral, contradicts semantic → declared intent doesn't match reality
- **Stable interfaces:** High structural, low behavioral → good design, working abstraction

---

## Incremental Analysis and Caching

The co-change graph is computed incrementally. Git provides a natural mechanism: store the last analyzed commit SHA, then `git log <sha>..HEAD` yields only new commits. New edge weights are appended to existing ones.

Cache is stored in `.varp/` (a new convention for varp-managed derived state). The cache is invalidated when:

- HEAD has moved (new commits to analyze — append only)
- Filter configuration has changed (full recompute required)

This means the expensive initial analysis runs once; subsequent runs process only new history.

---

## Relationship to varp Core

This lives within varp core as a new `analysis` submodule (`packages/varp/src/analysis/`). It extends varp's existing primitives:

- **Tags** → labeling system for inferred and declared components
- **Import graph** → the existing structural signal layer (already implemented in `manifest/`)
- **Cross-cutting file declarations** → components spanning arbitrary files

The co-change parser is a pure function (git log → edge weights) with no manifest dependency. The diagnostic matrix combines the parser output with manifest data. This separation means the parser could be extracted into its own package if other tools want to consume git co-change data independently.

### Output Surfaces

The analysis is exposed through three interfaces:

- **MCP tools** — Agents query coupling scores during planning (cached, fast). _"What else changes when I touch this file?"_
- **CLI commands** — Developers run diagnostics on demand. _"Show me hidden coupling hotspots."_
- **Audit input** — The audit engine consumes the graph for batch architectural smell detection.

All three share the same underlying cached graph; they differ in query patterns and presentation.

---

## V1 Scope

V1 delivers the co-change parser and the structural-vs-behavioral diagnostic matrix. This is the minimum surface that produces novel, actionable findings.

**In scope:**

- Co-change parser (git log → weighted edge graph)
- Graduated commit weighting (1/(n-1))
- Commit message noise filtering
- Incremental analysis with `.varp/` cache
- Diagnostic matrix: structural (imports) vs behavioral (co-change)
- MCP, CLI, and audit output surfaces

**Out of scope (future):**

- Clustering algorithms (Louvain, spectral) for component inference
- Visualization beyond the matrix
- Temporal directionality (A changes before B)
- Time decay weighting
- Additional signal layers (type references, runtime traces, name similarity)

---

## Open Questions

- What clustering algorithm best fits the gradual declaration model (where some nodes have explicit assignments)?
- What's the right default commit size ceiling?
- What commit message patterns should the default noise filter include?
- How does the audit engine consume the weighted graph — as a tool call, or as a data dependency injected into the audit context?
