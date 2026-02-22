# Three-Layer Refactor — Design

**Date:** 2026-02-19
**Implements:** [ADR-002](../decisions/adr-002-three-layer-architecture.md)
**Status:** Approved

## Goal

Make the three-layer architecture from ADR-002 explicit through interface schemas and type narrowing. The codebase already aligns ~80% — the scheduler and enforcement modules have no cross-layer imports. This refactor codifies the boundaries.

## What changes

### 1. New schemas in `shared/types.ts`

**`CodebaseGraph`** — The analysis layer's output contract. Composition of existing types:

```typescript
const CodebaseGraphSchema = z.object({
  manifest: ManifestSchema,
  coChange: CoChangeGraphSchema,
  imports: ImportScanResultSchema,
  coupling: CouplingMatrixSchema.optional(),
});
```

Consumers get one bundle. Analysis functions continue to produce the parts independently; `CodebaseGraph` is assembled by the consumer or a convenience function.

**`TaskDefinition`** — The scheduler's input contract. Extracted from the scheduler's file-local `Pick<Task, ...>` types:

```typescript
const TaskDefinitionSchema = z.object({
  id: z.string(),
  touches: TouchesSchema,
  mutexes: z.array(z.string()).optional(),
});
```

This is what the scheduler needs — no `action`, `values`, or `description`.

**`TaskResult`** — Deferred. The only executor is audit, which we're leaving alone. Define when a second executor needs the contract.

### 2. Narrow `Wave` to `TaskDefinition`

Current `Wave` carries full `Task[]` including execution fields (`action`, `values`). After the refactor:

```typescript
const WaveSchema = z.object({
  id: z.number(),
  tasks: z.array(TaskDefinitionSchema),
});
```

The consumer maps `Wave.tasks` back to full `Task` objects for dispatch using the plan's task list as a lookup. The scheduler never sees execution intent.

### 3. Update scheduler functions

Replace file-local `Pick<Task, ...>` types with `TaskDefinition`:

- `hazards.ts`: `TaskRef` → `TaskDefinition`
- `waves.ts`: `SchedulableTask` → `TaskDefinition`
- `critical-path.ts`: `SchedulableTask` → `TaskDefinition`

Function signatures change from accepting `Pick<Task, ...>` to accepting `TaskDefinition`. Since the shapes are identical, this is a type-level change — no runtime behavior changes.

### 4. Update MCP tool handlers

Tools that compute waves or hazards currently pass full `Task[]`. After the refactor, they extract `TaskDefinition[]` from the plan before passing to scheduler functions. This is a minor mapping step.

`varp_validate_plan` remains a convenience that composes all three layers — this is the consumer's job per ADR-002.

### 5. Update `lib.ts` and `lib.d.ts`

Export `CodebaseGraph`, `TaskDefinition`, and the updated `Wave` type. Update the hand-maintained `lib.d.ts` to match.

## What doesn't change

- **Analysis functions** — `scanCoChanges`, `buildCouplingMatrix`, `scanImports` keep their existing signatures. They produce the parts; `CodebaseGraph` is assembled by consumers.
- **Enforcement** — Already clean. No changes needed.
- **Plan parsing** — Already clean. No changes needed.
- **Audit** — Left alone entirely. Execution-layer extraction deferred.
- **CLI** — Already consumes analysis functions directly. May optionally assemble `CodebaseGraph` but not required.

## Blast radius

| Area                  | Impact                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `shared/types.ts`     | Additive (new schemas) + narrowing (`WaveSchema.tasks`)                                                            |
| `scheduler/*.ts`      | Type-only (replace local `Pick<>` with `TaskDefinition`)                                                           |
| `MCP tool handlers`   | Minor mapping (extract `TaskDefinition[]` from `Task[]`)                                                           |
| `lib.ts` / `lib.d.ts` | Additive (new exports) + update (`Wave` type change)                                                               |
| Tests                 | Scheduler tests may need fixture updates if they construct full `Task` objects where `TaskDefinition` now suffices |

## Verification

1. `turbo check` passes (format + lint + build across all packages)
2. `turbo test` passes (all existing tests)
3. MCP integration tests still work (`bun test packages/core/src/index.test.ts`)
4. Scheduler tests still work (`bun test packages/core/src/scheduler/`)
5. CLI coupling command still works (`bun run packages/cli/dist/cli.js coupling --help`)
