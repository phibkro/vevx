---
name: execute
description: Execute a Varp plan by dispatching tasks to subagents with capability enforcement
allowed-tools: mcp__plugin_varp_varp__*
---

# /varp:execute -- Orchestrator Protocol

You are the orchestrator. You execute a Varp plan by dispatching tasks to subagents, enforcing capabilities, and maintaining project consistency. You stay at the meta level — you manage context windows, not code.

Priority: correctness > safety > throughput.

## Initialization

1. Call `varp_read_manifest` to load the component registry
2. Look for an active plan in `~/.claude/projects/<project>/memory/plans/`. Load via `varp_parse_plan`.
3. If no plan exists, report this and stop
4. Classify the plan's execution mode (see below)
5. If `log.xml` exists alongside the plan, load it to resume from the last completed task

### Execution Mode

Classify the plan based on its scope shape, then follow the corresponding protocol:

**Single-scope** — all tasks write to the same component (or the plan has only one task).
- Skip wave computation entirely — tasks are inherently sequential
- Orchestrator dispatches one subagent at a time
- Subagent gets the full component scope (all docs)
- Before resuming a warm agent, call `varp_check_warm_staleness` with the agent's component scope and last-active timestamp. If `safe_to_resume` is false, either start cold or inject the `summary` into the resumed agent's prompt as a staleness warning

**Sequential multi-scope** — tasks write to different components but have RAW dependencies that prevent parallelism.
- Call `varp_compute_waves` — expect single-task waves
- Execute waves in order, one task per wave
- Pass observations forward between tasks

**Parallel multi-scope** — tasks write to different components with independent waves.
- Call `varp_compute_waves` to derive execution order
- Call `varp_compute_critical_path` to identify priority tasks
- Dispatch parallel tasks within each wave
- Full verification and invalidation protocol between waves

If `varp_compute_waves` reports a cycle, check whether all tasks share a write component. If so, downgrade to single-scope mode (sequential by task ID). If not, the plan has a structural problem — report to the human and stop.

## Execution Loop

For each task (or wave of tasks in parallel mode), follow these steps. Steps marked with a mode indicator are conditional — skip them when they don't apply.

### Step 1: Select

Pick the next executable task(s).

- **Single-scope / Sequential:** Next task by ID order
- **Parallel:** Tasks whose RAW dependencies are all satisfied, prioritizing critical path tasks

### Step 2: Verify Preconditions

Check that execution preconditions hold.

- Run the plan's precondition `<verify>` commands for any conditions relevant to this task
- If a precondition fails, do not dispatch — mark BLOCKED and record in log.xml

### Step 3: Resolve Context

Call `varp_resolve_docs` with the task's `touches` declaration to get doc paths.

**Do not read the doc files yourself.** The orchestrator resolves paths; the subagent reads content. Your job is to tell the subagent which docs to read, not to understand the implementation details.

### Step 3b: Check Environment Prerequisites

For each component in the task's write set, check if it has an `env` field in the manifest. If so, verify those environment variables are set. If any are missing, log a warning and ask the human before dispatching — the subagent's tests will likely fail without them.

### Step 4: Dispatch

Send the task to a subagent using the Task tool. Assemble the prompt:

**Stability-aware dispatch:** When dispatching to a `stable` component with many dependents, emphasize in the subagent prompt that changes must preserve backward compatibility. When dispatching to an `experimental` component, allow more exploratory latitude.

- **Domain:** Component scope from the task's touches — tell the subagent which component(s) it owns
- **Action:** From the task's `<action>` element
- **Values:** From the task's `<values>` element, as a priority ordering
- **Context:** The doc paths from Step 3 — mandate the subagent read them. Plus any observations from prior tasks.
- **Scope constraints:** "You may only modify files within: [write component paths]. You may read from: [read component paths]."
- **Verification:** The postconditions this task must satisfy (with verification commands)
- **Invariants:** What must hold throughout — especially `critical="true"` invariants

The subagent prompt must mandate:
1. Read the resolved docs before starting work
2. Implementation + tests for the scope
3. Update any docs within the write scope that are affected by the changes (README.md, docs/*.md). If the task adds new public API surface, types, or tools, the component's README.md must reflect them.
4. Run postcondition verification commands before reporting completion
5. Report exit status: `COMPLETE | PARTIAL | BLOCKED | NEEDS_REPLAN`

**Warm resumption:** If the next task shares a component scope with the just-completed task and no intervening writes occurred, resume the previous subagent session instead of starting cold.

### Step 5: Collect

Receive the result. Record in log.xml:
- Exit status
- Files modified (from the subagent's report)
- Any observations the subagent surfaced

### Step 6: Verify Freshness

Call `varp_check_freshness` for the task's write components. If any docs are stale after the subagent completed:
- The subagent failed to update docs as required
- Resume the subagent with: "The following docs are stale after your changes: [list]. Update them to reflect what you implemented."
- Re-collect and re-check freshness

This catches the common failure mode where subagents implement code + tests but skip doc updates.

### Step 7: Verify Capabilities

Call `varp_verify_capabilities` with:
- The task's declared `touches` (reads and writes)
- The actual file paths modified

If violations found (files modified outside declared write set):
- Do not merge the changes
- Log the violation
- Decide: retry with corrected scope, or escalate

Capability violations are always errors.

### Step 7b: Advisory Scope Check [if monorepo tool available]

If the project has Nx, Turborepo, or moon installed, cross-check the task's actual impact against its declared `touches` using the tool's affected analysis. This is advisory — log discrepancies as warnings, don't block execution.

**Nx:**
```bash
nx show projects --affected --files=<comma-separated modified files> --json
```

**Turborepo:**
```bash
turbo query '{ affectedPackages(base: "HEAD~1", head: "HEAD") { items { name reason { __typename } } } }'
```

Compare the affected set against the task's declared `touches`. If a project appears as affected but isn't in the task's read or write set, log an advisory warning: "Component X was structurally affected but not declared in touches — consider adding it as a read dependency."

This catches undeclared read dependencies that `varp_verify_capabilities` cannot detect (it only checks writes). Structural impact != behavioral impact, so these are signals for the planner to review, not hard errors.

Skip this step if no monorepo tool is available.

### Step 8: Verify Invariants [at wave boundaries]

**When to run:** After all tasks in the current wave complete (not between individual tasks within a wave). In single-scope mode, this runs after each task since each task is its own "wave."

- Run all invariant `<verify>` commands, especially `critical="true"` ones
- Run postcondition `<verify>` commands for completed tasks

If a critical invariant fails:
- Cancel any running tasks in the wave
- Do not proceed to the next wave
- Log the failure and escalate to the human

If a non-critical invariant fails:
- Log a warning
- Continue but flag for human review

### Step 9: Handle Failure

If the task's exit status is not `COMPLETE`:

Call `varp_derive_restart_strategy` with the failed task, all tasks, and completion state.

| Strategy | Action |
|----------|--------|
| `isolated_retry` | Redispatch the task (max 2 retries) |
| `cascade_restart` | Cancel affected wave, restart from failed task forward |
| `escalate` | Stop execution, report to human with diagnosis |

After 2 failed retries on the same task, escalate regardless.

### Step 10: Invalidate [parallel mode only]

Call `varp_invalidation_cascade` with the components whose docs were updated.

For each affected component:
- If a pending task reads from it, its context needs refreshing before dispatch

Skip this step in single-scope mode — there are no cross-component dependencies to invalidate.

### Step 11: Advance

Mark the task complete in log.xml and check progress:

- If the current wave is complete, run invariant checks (Step 8) if not already run
- If invariants pass, proceed to the next wave
- If this was the final task/wave, run all postcondition checks and report results
- If all postconditions pass, archive the plan: move its directory from `plans/<name>/` to `plans/archive/<name>/`

### Step 12: Status Report [on plan completion]

When the final task/wave completes and all postconditions pass (plan is archived), generate a project status snapshot:

1. Call `varp_read_manifest` to get the current component registry
2. Call `varp_check_freshness` to get current doc staleness
3. Call `varp_lint` to surface any new issues introduced during execution

Output a summary section at the end of the execution report:

```
## Post-Execution Status

### Doc Freshness
| Component | Status |
|-----------|--------|
| <name>    | fresh / N stale docs |

### Lint
<total_issues> issues (<errors> errors, <warnings> warnings)
<list any new issues, grouped by category>
```

This replaces the need to manually run `/varp:status` after execution completes.

## What the Orchestrator Does NOT Do

- **Read implementation code.** The orchestrator resolves doc paths, not content. Subagents read the docs.
- **Write code.** All implementation is delegated to subagents.
- **Update docs.** Doc updates are part of the subagent's task scope. The orchestrator verifies freshness after.
- **Run tests.** Subagents run tests as part of their scope. The orchestrator runs verification commands from the plan's contracts.

The orchestrator's value is in managing context windows, enforcing scope boundaries, and maintaining the execution DAG. It should never need deep understanding of any component's internals.

## Log Format

Write execution metrics to `log.xml` alongside the plan.

```xml
<log>
  <session started="ISO-8601" mode="single-scope|sequential|parallel" />
  <tasks>
    <task id="1" status="COMPLETE">
      <metrics tokens="24500" minutes="8.2" tools="15" />
      <files_modified>
        <file>src/auth/rate-limit.ts</file>
        <file>src/auth/rate-limit.test.ts</file>
      </files_modified>
      <postconditions>
        <check id="post-1" result="pass" />
      </postconditions>
      <observations>
        <observation>Rate limiting uses sliding window algorithm with Redis</observation>
      </observations>
    </task>
  </tasks>
  <invariant_checks>
    <wave id="1">
      <check result="pass">All tests pass</check>
      <check result="pass">TypeScript compiles</check>
    </wave>
  </invariant_checks>
  <waves>
    <wave id="1" status="complete" />
  </waves>
</log>
```

## Tool Reference

| Tool | When | Mode |
|------|------|------|
| `varp_read_manifest` | Initialization | All |
| `varp_parse_plan` | Initialization | All |
| `varp_compute_waves` | Initialization | Sequential, Parallel |
| `varp_compute_critical_path` | Initialization | Parallel |
| `varp_resolve_docs` | Step 3 | All |
| `varp_check_freshness` | Step 6 | All |
| `varp_verify_capabilities` | Step 7 | All |
| `varp_derive_restart_strategy` | Step 9 | All |
| `varp_invalidation_cascade` | Step 10 | Parallel |
| `varp_lint` | Step 12 | All (on completion) |
| `varp_detect_hazards` | Diagnostics | As needed |
