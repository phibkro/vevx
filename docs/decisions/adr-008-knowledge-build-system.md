# ADR-008: Varp's analysis layer as a knowledge build system

**Status:** Proposed
**Date:** 2026-03-02
**Deciders:** @phibkro

## Context

Varp's analysis layer already tracks documentation freshness — comparing doc timestamps against source timestamps using the dependency graph from `varp.yaml`. This is the same pattern build systems use: inputs, outputs, dependency graph, staleness detection, incremental rebuild.

Documentation is not the only artifact downstream of source code. Declarations (`.d.ts`), test coverage, coupling diagnostics, symbol indices, and hotspot scores are all derived from source and become stale when source changes. Each has inputs, outputs, and invalidation rules — they are build targets.

Kart's `.d.ts` caching proposal (#25) makes this connection explicit: generate declarations from source, cache them, detect staleness via the dependency graph, rebuild incrementally on access. This is what tsc `--incremental` does. The question is whether varp should formalize this pattern across all knowledge artifacts.

ADR-002 describes varp as a compiler: `parser → analysis passes → scheduler → executor`. The analysis layer currently *reads* the codebase and *computes* ephemeral insights. This ADR proposes that analysis passes also *produce cached artifacts* and *track their freshness* — making the analysis layer a build system.

See `docs/knowledge-build-system.md` for the conceptual argument.

## Decision

Extend varp's analysis layer to function as a knowledge build system: source files and git history are inputs, knowledge artifacts are outputs, the `CodebaseGraph` is the dependency and invalidation mechanism.

### What this means concretely

1. **Uniform staleness model.** All derived artifacts — docs, declarations, diagnostics, indices — use the same staleness detection: walk the transitive input set via the dependency graph, flag if any input changed.

2. **Extend existing tools for rebuilds.** Varp detects staleness. Existing tools do the actual rebuilding:
   - `.d.ts` → tsc `--incremental --declaration`
   - task caching → turbo content hashing
   - coupling diagnostics → varp's own co-change parser
   - documentation → agent or human
   - test coverage → signal "needs review" (no automatic rebuild)

3. **Lazy invalidation, lazy rebuild.** Don't rebuild eagerly on every source change. Detect staleness, rebuild on next access. This matches agent interaction patterns — agents query when they need information, not continuously.

4. **Lexical signal layer.** Add filename substring matching as a fourth signal in the `CodebaseGraph`. Files sharing a stem (`auth.ts`, `auth.test.ts`, `auth.d.ts`, `docs/auth.md`) carry a higher prior correlation. Nearly free to compute, captures naming-convention dependencies invisible to other signals.

5. **Consume `.tsbuildinfo`.** For declaration artifacts, read tsc's existing dependency graph rather than recomputing it. Extend, don't replace.

### What the analysis layer becomes

```
source files + git history
  → parser (import graph, co-change, file enumeration, lexical stems)
  → analysis passes (coupling, hotspots, complexity trends)
  → derived artifacts (declarations, docs, diagnostics, symbol index)
  → freshness tracking (what's stale, what needs rebuilding)
```

The scheduler and executor layers (ADR-002) are unchanged — they operate on tasks, not artifacts.

## Consequences

### Positive

- Documentation freshness generalizes to all knowledge artifacts without new infrastructure — same dependency graph, same staleness model
- Kart's `.d.ts` caching (#25) and zoom index become natural instances of the pattern, not special cases
- Existing tools (tsc, turbo) handle the expensive rebuilds — varp adds the knowledge layer on top
- Lazy rebuild avoids wasted computation — only rebuild what agents actually query
- Lexical signal captures naming-convention dependencies that structural, behavioral, and semantic signals miss

### Negative

- `.tsbuildinfo` format is not formally stable — consuming it creates a coupling to tsc internals
- Transitive staleness detection requires walking the dependency graph per artifact — could be expensive for large graphs without caching the walk itself
- "Stale" may need to become a spectrum (confidence levels) rather than binary, adding complexity to the freshness API

### Neutral

- The existing `varp_check_freshness` tool becomes an instance of the general pattern, not a special-purpose doc checker
- `.varp/` cache directory (already used for co-change graph) grows to include freshness state for all artifact types
- MCP tools can surface staleness alongside query results ("these coupling diagnostics are 3 commits stale")

## Open questions

1. **Granularity.** File-level staleness is straightforward. Function-level staleness (did the public API change, or just internals?) is more useful but requires diffing declarations. Worth the complexity?

2. **Confidence levels.** Direct dependency changed = definitely stale. Co-change signal = probably stale. Lexical match = possibly stale. Should the API report confidence rather than binary flags?

3. **Rebuild cost prioritization.** Stale `.d.ts` is cheap to fix (run tsc). Stale design doc is expensive (needs review). Should the system surface low-cost, high-value rebuilds first?

4. **Test staleness semantics.** Source changed, but the test might still pass. Is a test "stale" when its inputs changed, or only when its assertions no longer cover the changed behavior?

## Alternatives considered

### Build a custom incremental compilation system

Rejected. tsc `--incremental` and turbo already solve file-level caching and dependency tracking for compiled artifacts. Reimplementing this adds maintenance burden without differentiation. Varp's value is the *knowledge layer* — staleness detection for artifacts those tools don't know about.

### Keep freshness as a doc-only feature

Rejected. The pattern clearly generalizes. Treating doc freshness as special means building parallel infrastructure for `.d.ts` caching (#25), zoom index freshness, and diagnostic freshness. The unified model is simpler.

### Eager rebuild on file change (watch mode)

Rejected for the default behavior. Agents don't need continuous rebuilds — they query on demand. Eager rebuild wastes computation on artifacts that may never be accessed in a given session. A watch mode could be offered as an opt-in for CI or long-running environments, but lazy-on-access is the right default.

## References

- ADR-002: Three-Layer Architecture (analysis/scheduler/executor)
- `docs/knowledge-build-system.md`: conceptual argument
- #25: Generate and cache `.d.ts` files for kart zoom output
- tsc `--incremental`: https://www.typescriptlang.org/tsconfig/#incremental
- Turbo caching: https://turbo.build/repo/docs/crafting-your-repository/caching
