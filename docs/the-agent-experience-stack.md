# the agent experience stack

> the tools we built during the human developer era optimized for human cognitive constraints. those constraints no longer apply — and the tradeoffs flip.

---

## prologue

in the early days of software, developer experience didn't exist as a concept. you wrote assembly, you managed memory, you held the entire machine model in your head. the tools were minimal because the expectation was that developers would adapt to the machine.

then the field matured. we built abstractions — languages, editors, libraries, package managers — not because the machines needed them, but because humans did. we invented IDEs to compensate for limited working memory. we invented dynamic languages to make iteration fast. we invented the filesystem hierarchy because trees are easy for humans to navigate mentally.

every major tool in the modern developer stack is, at its core, a cognitive aid for a human brain. and that was the right call — humans were the bottleneck.

they no longer are.

as AI agents become the primary writers and maintainers of code, we need to ask a different question: not "what helps a human navigate a codebase" but "what helps an agent reason about one." the answer requires rethinking the stack from the ground up — storage, tooling, and language design all at once.

this is an argument for three interconnected changes. together they describe what we're calling the **agent experience stack** — AX, the successor to DX.

---

## argument 1: the filesystem is a leaky abstraction

the filesystem was designed for a specific kind of user: a human who maintains a mental model of a hierarchy, navigates it by browsing, and finds things by remembering where they put them.

agents don't work this way. they don't browse. they reason about what they need, then retrieve it. the path `/src/auth/session/handler.ts` is meaningful to a human who remembers creating it. to an agent starting a new session with no persistent memory, it's an arbitrary string.

the core mismatches:

**locality is wrong.** the filesystem organizes by type and domain — `components/`, `utils/`, `tests/`. agents working on a task need everything relevant to that task, regardless of where it lives. the hierarchy is optimized for human organization, not agent retrieval.

**no semantic retrieval.** you can't ask a filesystem "give me everything related to the authentication refactor from last week." you need a layer on top — which is why every serious agent framework ends up bolting on a vector database as an afterthought.

**mutation is lossy.** overwriting a file destroys the trajectory. agents benefit from knowing *how* something got to its current state, not just what it currently is. without history, each new session starts blind.

**no provenance.** files don't record what produced them, what decisions led to them, or what depends on them. when an agent needs to change something, it has no way to understand the causal chain it's entering.

the fix isn't exotic. git already solves the hard parts: content-addressable storage, append-only history, built-in provenance, immutable past. every software project already has a git history. the missing piece is a semantic index layer on top — one that makes the codebase queryable by meaning, not just by path.

build that index from git. use sqlite for structured queries, sqlite-vec for semantic retrieval, folder-derived tags as the default vocabulary. expose it through an MCP server with progressive disclosure: `list_artifacts` returns lightweight summaries, `get_artifact` returns full content, `get_provenance` returns the causal chain. agents navigate by relevance, not by hierarchy.

the distribution story is elegant: install the tool on any existing repo, get semantic retrieval over your entire project history from day one. no migration, no new mental model, no lock-in. the index is derived and reconstructable — uninstall and nothing about your repo changed.

this is what the storage layer looks like when agents are the primary users.

---

## argument 2: IDEs helped humans develop software — now it's agents' turn

the IDE is the defining artifact of the human developer era. syntax highlighting, file trees, go-to-definition, inline errors, autocomplete — every feature exists to compensate for a specific human cognitive limitation.

syntax highlighting reduces parsing load. the file tree externalizes the mental model of the project structure. go-to-definition substitutes for memorizing every function's location. inline errors surface problems at the moment of writing, when context is fresh. autocomplete reduces the need to remember exact names.

all of it is cognitive offloading for a brain that can hold about seven things in working memory at once.

agents don't have that limitation. an agent can hold an entire file in context trivially. it doesn't benefit from color-coded tokens or collapsible folders. from an agent's perspective, the IDE is almost entirely useless — a beautiful machine for solving problems agents don't have.

but the *language server* underneath the IDE is a different story.

LSP exposes real semantic understanding of code: call hierarchies, type hierarchies, all references, workspace symbols, diagnostics. this is exactly what agents need to reason about a codebase — not visual navigation aids, but structured answers to questions like "what would break if i changed this?" and "what are all the places this interface is implemented?"

the problem is that LSP was designed for human interaction patterns: event-driven, cursor-centric, incremental. hover gives you a tooltip at a cursor position. completion gives you suggestions as you type character by character. the underlying data is right; the interface is wrong.

an agent-native language protocol would expose the same semantic data differently:

instead of *hover at position (x, y) → tooltip string*, give agents *get\_symbol\_info(name) → structured type, signature, documentation*.

instead of *completion at cursor → list of strings*, give agents *query\_symbols(scope, kind) → structured list with types*.

instead of *call hierarchy rooted at cursor*, give agents *get\_impact(symbol) → all direct and transitive dependents, files affected*.

the last one doesn't exist in LSP at all. it's what agents need most — not "what is at this position" but "what is the blast radius of changing this thing." agents are uniquely bad at knowing what they don't know. a tool that surfaces unknown dependencies before a change is made would eliminate a significant class of agent errors.

there's also a feature LSP has that looks useless but isn't: folding ranges. for humans, folding ranges collapse sections visually. for agents, the same underlying data enables *progressive disclosure* — showing only the public interface of a module first, then protected members, then private implementation, expanding depth only when the agent decides it needs to go deeper.

agents have a fixed context budget. they can't load every file in a large codebase. but they can load a level-0 representation of every file — public signatures only, no bodies — identify which files are relevant, then expand to level 1 or 2 only on those. the same operation humans use to hide complexity becomes the mechanism agents use to manage context.

this is the design principle that unifies both arguments: **agents always start shallow and drill on demand. tools should make shallow-by-default easy and deep-on-demand explicit.**

that principle, consistently applied across storage and tooling, describes most of what the agent-native development environment needs to look like.

---

## argument 3: static types were a tradeoff — agents eliminate the cost

for most of the history of software, type systems were a tradeoff. richer types meant more correctness, but also more verbosity, slower iteration, steeper learning curves. dynamically typed languages won significant market share precisely because velocity often mattered more than correctness — a working prototype in python beats a formally verified haskell program that isn't written yet.

this was a reasonable tradeoff when humans were writing the code. humans are slow. the cost of a type annotation — the extra seconds of thought, the friction of satisfying the compiler — was real and measurable. dynamic languages removed that friction and let developers move faster.

agents are not slow. they generate typed code as easily as untyped code. the velocity cost of a rich type system is zero when the agent is doing the writing.

the tradeoff evaporates. what remains is only the benefit.

and the benefits compound significantly in the agent context:

**types are the only documentation agents can trust unconditionally.** comments drift from implementation. doc strings go stale. training data becomes outdated. a type signature is enforced by the compiler — it cannot be wrong about itself. for an agent operating across sessions with no persistent memory, the type system is the only reliable record of intent that survives.

**preconditions as assertions are documentation, enforcement, and test oracle simultaneously.** a doc comment saying "amount must be positive" is a hint. a branded `PositiveNumber` type is a proof. the agent cannot pass a negative number — not because it was trained not to, but because it is *structurally impossible*. this collapses three concerns into one: the constraint is documented (agents can read the type), enforced (the compiler rejects violations), and automatically testable (property-based tests can verify the boundary).

**effect types surface what prose cannot.** a function's side effects — network calls, database writes, state mutations — are invisible in a dynamically typed codebase. agents making changes can't know what they're affecting without running the code or reading every implementation. with effect types (effect-ts, haskell's IO monad, rust's ownership system), the side effects are in the signature. an agent reading `Effect<User, DatabaseError, never>` knows more from that type than from three paragraphs of documentation.

**invariants survive refactoring.** when a codebase evolves, rich types propagate the impact of changes automatically. if `Account` gains a new required field, every construction site breaks at compile time. agents working on a mature codebase don't need to discover these dependencies by running the code and observing failures — the type checker surfaces them immediately.

the deeper point is that correctness-through-code produces better signal for agents too. every type error is precise, structured, located: "this call violates the contract at this exact point, here's why." compare that to runtime failures, which are often distant from their cause, or to prose documentation, which requires natural language understanding to interpret. types speak directly to the agent's ability to reason formally.

the implication is a reordering of language priorities for the agent era. a language or type system that "slows developers down" needs to be re-evaluated: which developers? if the primary developer is an agent, the slowdown doesn't exist. what remains is only the correctness guarantee, the structural documentation, the enforced contracts.

typescript with effect-ts is probably the closest current approximation — expressive enough to encode preconditions, postconditions, and effects in the type system, while remaining practical for the human developers who still need to read and guide the code. rust's ownership system achieves similar guarantees in a different domain. the direction of travel is clear.

write code that makes the wrong thing unrepresentable, not code that makes the right thing easy to write. for agents, those are the same thing.

---

## the stack

the three arguments describe three layers:

```
correctness layer   →  rich types, assertions as contracts, effect systems
understanding layer →  agent-native LSP, progressive disclosure, impact analysis  
storage layer       →  git-backed semantic index, provenance, artifact retrieval
```

each layer feeds the ones above it. a well-typed codebase makes the understanding layer more powerful — contracts are extractable from types rather than parsed from comments. a rich understanding layer makes the storage layer more useful — artifacts can be indexed with semantic meaning derived from code structure, not just folder names.

together they describe what software infrastructure looks like when agents are the primary developers. not a replacement for the human developer era's tools — most of those tools still exist, still work, still matter for the humans who read and guide the code. but a new layer on top, designed from the ground up for a different kind of collaborator with a different set of constraints and capabilities.

the human developer era optimized for human cognitive limits. the agent era optimizes for agent cognitive limits — and unlocks what was previously too expensive to build.

---

## epilogue

the shift from human to agent as primary developer isn't just a productivity change. it's a constraints change. and when the constraints change, the right tools change with them.

we spent decades building DX — developer experience — making tools that felt good for humans to use. the next decade will be about AX — agent experience — making tools that enable agents to reason correctly about code at scale.

the three arguments above are not a complete picture. they are a starting point. the question of what the full AX stack looks like is genuinely open — the conventions haven't been established, the primitives are still being discovered, the tradeoffs are still being understood.

but the direction is clear: storage that agents can query semantically, tooling that agents can use to reason about impact, and languages that make correct code the path of least resistance.

build for the agent. the human will benefit too.
