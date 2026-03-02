# knowledge build systems

> build systems answer one question: given what changed, what's stale? the same question applies to knowledge about the codebase — not just compiled artifacts.

---

## the connection

build systems and project analysis tools solve the same core problem:

1. maintain a dependency graph
2. detect what's stale
3. incrementally rebuild only what changed

tsc tracks `foo.ts → foo.js` and rebuilds when the source changes. turbo tracks `package.json + src/** → dist/` and skips the task when inputs haven't changed. both are input→output pipelines with invalidation.

documentation freshness is the same pattern. compare doc timestamps against source timestamps. the dependency graph comes from the project manifest, which declares which docs describe which components. but documentation is just one derived artifact. the pattern generalizes.

---

## derived artifacts

every codebase has artifacts that are downstream of source code. when source changes, these artifacts become stale:

| artifact | derivation |
|----------|-----------|
| documentation | source behavior → prose description |
| declarations (`.d.ts`) | source types → public API surface |
| test coverage | source behavior → behavioral assertions |
| coupling diagnostics | git history → co-change matrix |
| symbol index | source symbols → cached symbol tree |
| hotspot scores | git history + LOC → frequency × size |

these are all build targets. they have inputs, outputs, and invalidation rules. the difference from traditional build systems: the outputs are *knowledge artifacts* consumed by agents, not compiled artifacts consumed by runtimes.

a traditional build system asks: is `foo.js` up to date with `foo.ts`?

a knowledge build system asks: is the agent's understanding of `foo.ts` up to date with `foo.ts`?

---

## the dependency graph

what makes this more than a per-file mtime check is the dependency graph. when `auth.ts` changes, the staleness cascades:

- `auth.d.ts` is stale (it declares auth's API)
- `auth.test.ts` *might* be stale (it asserts auth's behavior)
- `docs/auth.md` is stale (it describes auth)
- `session.ts` might be stale (it imports auth)
- `db/migrations/024.sql` might be stale (it co-changes with auth historically)

the first three are direct dependencies. the fourth is a structural dependency (import graph). the fifth is a behavioral dependency (co-change history). each requires a different signal to detect.

four signal layers can be combined:

| signal | source | detects |
|--------|--------|---------|
| structural | import graph (static analysis) | declared dependencies |
| behavioral | git co-change frequency | empirical dependencies |
| semantic | manifest declarations, tags | intentional dependencies |
| lexical | filename substring matching | naming-convention dependencies |

`auth.ts`, `auth.test.ts`, `auth.d.ts`, `docs/auth.md` — these share a stem. files matching substrings should carry a higher prior correlation than unrelated filenames. this is nearly free to compute and captures a dependency that none of the other signals express: the human convention of naming related files similarly.

---

## extend, don't replace

the key insight is that a knowledge build system doesn't need to replace existing build systems. it needs to extend the invalidation model to cover knowledge artifacts.

tsc already knows how to produce `.d.ts` files incrementally. turbo already knows how to cache task outputs by content hash. the knowledge layer sits on top:

1. **track which knowledge artifacts exist** (the manifest)
2. **know which source files they derive from** (the dependency graph)
3. **detect when they're stale** (multi-signal staleness)
4. **signal what needs updating** (surface to agents)
5. **optionally trigger rebuilds** (delegate to existing tools)

for `.d.ts` files: detect staleness, let tsc rebuild. for documentation: detect staleness, let the agent (or human) rewrite. for coupling diagnostics: detect staleness, re-walk the git history.

the rebuild strategy varies by artifact type. the staleness detection is uniform.

---

## lazy invalidation

traditional build systems use two staleness strategies:

- **mtime comparison**: is the output older than the input? fast, coarse, misses transitive changes.
- **content hashing**: did the input actually change? slower, precise, handles transitive invalidation via hash chains.

mtime is sufficient for "did the source file change since the doc was last touched?" but insufficient for transitive invalidation — if `types.ts` changes and `auth.ts` re-exports from it, `docs/auth.md` should be flagged even though `auth.ts` wasn't touched.

the dependency graph solves this. for each derived artifact, walk its transitive input set. if any input is newer (mtime) or different (content hash), the artifact is stale.

importantly: don't rebuild eagerly on every source change. detect staleness, then rebuild on next access. this matches the agent interaction pattern — agents query for information when they need it, not continuously. lazy invalidation, lazy rebuild.

tsc's `.tsbuildinfo` already stores the declaration dependency graph. a knowledge build system can consume it rather than recomputing it — extending existing tools rather than replacing them.

---

## open questions

1. **granularity**: file-level staleness is easy. function-level staleness (did the *public API* change, or just an internal implementation detail?) is more useful but harder. `.d.ts` diffing could provide this — if the declaration didn't change, downstream knowledge artifacts are still fresh even though the source changed.

2. **confidence vs binary staleness**: "stale" is binary. but some artifacts are *probably* stale (co-change signal, lexical match) vs *definitely* stale (direct dependency changed). should the system report confidence levels rather than binary flags?

3. **rebuild cost**: a stale `.d.ts` is cheap to rebuild (run tsc). a stale design doc is expensive (needs human or LLM review). should the system prioritize surfacing high-value, low-cost rebuilds first?

4. **test staleness**: when is a test "stale"? the source it covers changed — but the test might still pass. behavioral coverage (does the test exercise the changed code path?) is a deeper question than file-level staleness.
