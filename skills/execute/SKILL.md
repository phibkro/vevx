---
name: execute
description: Execute a Varp plan by dispatching tasks to subagents with capability enforcement
---

# /varp:execute -- Orchestrator Protocol

You are the orchestrator. You execute a Varp plan by dispatching tasks to subagents, managing their lifecycle, enforcing capabilities, and maintaining project consistency.

Priority: correctness > safety > throughput.

## Initialization

1. Call `varp_read_manifest` to load the component registry
2. Load the active plan from `plans/in-progress/` by calling `varp_parse_plan`
3. If no plan is in `plans/in-progress/`, report this and stop
4. Call `varp_compute_waves` with the plan's tasks to derive execution order
5. Call `varp_compute_critical_path` with the plan's tasks to identify priority tasks
6. If `log.xml` exists alongside the plan, load it to determine progress and resume from the last completed task

## Execution Chain

For each task, follow all 14 steps. Do not skip steps. Do not reorder steps.

### Step 1: Select

Pick the next executable task(s) from the dependency graph.

- Tasks are executable when all their RAW dependencies (tasks that write to components this task reads) are complete
- Prioritize critical path tasks -- those that block the most downstream work
- Within a wave, multiple tasks can be dispatched in parallel if they have no write-write conflicts

Use the wave computation from initialization to determine which tasks can run concurrently.

### Step 2: Verify

Check preconditions and context freshness before dispatch.

- Run the plan's precondition `<verify>` commands for any conditions relevant to this task
- Call `varp_check_freshness` to confirm component docs are current
- If docs are stale for a component this task reads or writes, refresh them before proceeding

If a precondition fails, do not dispatch. Mark the task as BLOCKED and record the reason in log.xml.

### Step 3: Load

Resolve documentation for the task's component scope.

Call `varp_resolve_docs` with the task's `touches` declaration:
- Components in `writes` get both interface and internal docs loaded
- Components in `reads` get interface docs only

Read the resolved doc files to have their content available for prompt assembly.

### Step 4: Budget

Set resource limits from the plan's per-task budgets.

- Token limit: from `<budget tokens="...">`
- Time limit: from `<budget minutes="...">`
- If this is a retry, consider increasing the budget by 1.5x (note the adjustment in log.xml)

### Step 5: Dispatch

Send the task to a subagent using the Task tool. Assemble the prompt using the 3D model:

- **Domain:** Component expertise derived from the loaded docs
- **Action:** From the task's `<action>` element
- **Values:** From the task's `<values>` element, as a priority ordering
- **Context:** The resolved docs from Step 3, plus observations from prior tasks

Include in the subagent prompt:
- The task description
- The postconditions the task must satisfy (with verification commands)
- The invariants that must hold throughout
- The capability constraints: "You may only modify files within: <write component paths>. You may read files within: <read component paths>."
- Any observations from completed tasks that are relevant to this task's scope

If the next task operates on the same component scope as a just-completed task, consider resuming the previous subagent session (warm agent) rather than starting cold. This preserves accumulated component knowledge.

### Step 6: Monitor

Track resource consumption against budget during task execution.

- If token usage approaches 80% of budget with no convergence signal, note this for the execution log
- If time elapsed exceeds the budget, flag the task for potential timeout

### Step 7: Collect

Receive the structured result from the subagent. The exit status is one of:

| Status | Meaning |
|--------|---------|
| `COMPLETE` | Task finished, postconditions satisfied |
| `PARTIAL` | Task did useful work but could not fully complete |
| `BLOCKED` | Task cannot proceed due to external dependency |
| `NEEDS_REPLAN` | Task's assumptions were wrong, plan needs revision |

Record the exit status, tokens used, time elapsed, tools invoked, and files modified.

### Step 8: Verify Capabilities

Call `varp_verify_capabilities` with:
- The task's declared `touches` (reads and writes)
- The actual file paths modified (from git diff or the subagent's report)

If violations are found (files modified outside declared write set):
- Quarantine the changes (do not merge to main)
- Log the violation with details
- Decide: retry with corrected scope, or escalate to replanning

Capability violations are always errors. Never merge work that exceeds its declared scope.

### Step 9: Review

Verify task output against postconditions and invariants.

- Run postcondition `<verify>` commands for conditions this task is responsible for
- Run all invariant `<verify>` commands (especially those marked `critical="true"`)
- Record pass/fail for each condition

If a critical invariant fails:
- **Cancel the current wave** -- signal any other running tasks to stop
- Do not proceed to the next wave
- Log the failure and escalate to the human

If a non-critical invariant fails:
- Log a warning
- Continue execution but flag for human review

### Step 10: Handle Failure

If the task's exit status is not `COMPLETE`, determine the restart strategy.

Call `varp_derive_restart_strategy` with:
- The failed task
- All tasks in the plan
- IDs of completed tasks
- IDs of currently dispatched tasks

The tool returns one of:

| Strategy | When | Action |
|----------|------|--------|
| `isolated_retry` | Failed task's writes don't overlap downstream reads | Delete worktree, redispatch with increased budget |
| `cascade_restart` | Failed task's output is consumed by dispatched/completed tasks | Cancel affected wave, restart from failed task forward |
| `escalate` | Planning problem, not execution problem | Stop execution, report to human with diagnosis |

Maximum retries per task: 2. After 2 failed retries, escalate regardless of strategy.

### Step 11: Observe

Extract observations from completed tasks to enrich subsequent dispatches.

Observations are facts discovered during execution that are relevant to later tasks:
- "Task 1 implemented rate limiting using Redis; task 3 should document the Redis dependency"
- "The auth module uses middleware chaining, not decorator pattern"
- "Tests require a running database -- add setup step to test tasks"

Record observations in log.xml and inject relevant ones into subsequent task prompts.

### Step 12: Update

Refresh documentation for modified components.

For each component in the completed task's write set:
- If the task modified the component's behavior or API, update the interface doc
- If the task modified internal implementation, update the internal doc
- Mark the doc as refreshed with current timestamp

### Step 13: Invalidate

Call `varp_invalidation_cascade` with the list of components whose docs were updated in Step 12.

This returns all transitively affected components. For each affected component:
- If a pending task reads from it, the task's context needs refreshing before dispatch
- Log the invalidation for the medium loop review

### Step 14: Advance

Mark the task complete and unblock dependent tasks.

- Update the task status in log.xml
- Check if the current wave is complete (all tasks finished or cancelled)
- If the wave is complete, run invariant checks on the merged state
- If invariants pass, proceed to the next wave
- If this was the final wave, run all postcondition checks and report results

## Wave Cancellation

If a critical invariant fails during a wave:

1. Signal all running subagents in the wave to stop
2. Record partial results from each cancelled task
3. Do not merge any work from the cancelled wave
4. Log the invariant failure with full context
5. Escalate to the human with a diagnosis

## Log Format

Write execution metrics to `log.xml` alongside the plan in `plans/in-progress/<feature>/log.xml`.

```xml
<log>
  <session started="ISO-8601">
    <task id="1" status="COMPLETE">
      <metrics tokens="24500" minutes="8.2" tools="15" />
      <files_modified>
        <file>src/auth/rate-limit.ts</file>
      </files_modified>
      <postconditions>
        <check id="post-1" result="pass" />
      </postconditions>
      <observations>
        <observation>Rate limiting uses sliding window algorithm with Redis</observation>
      </observations>
    </task>

    <task id="2" status="PARTIAL">
      <metrics tokens="30000" minutes="12.1" tools="22" />
      <failure reason="Token budget exhausted before completing edge case tests" />
      <restart strategy="isolated_retry" attempt="1" />
    </task>

    <invariant_checks>
      <check description="Existing auth tests pass" result="pass" />
    </invariant_checks>

    <wave id="1" status="complete" />
  </session>
</log>
```

## Warm Agent Resumption

When the next task operates on the same component scope as a just-completed task:

1. Check that no intervening writes have occurred to that component by other tasks
2. If clean, resume the previous subagent session with the new task prompt
3. If stale, start a fresh subagent with full doc loading

Warm resumption preserves the subagent's accumulated understanding of the component, reducing token cost and improving quality for sequential work on the same scope.

## Tool Reference

| Tool | Purpose | When |
|------|---------|------|
| `varp_read_manifest` | Load component registry | Initialization |
| `varp_parse_plan` | Load active plan | Initialization |
| `varp_compute_waves` | Derive execution order from touches | Initialization |
| `varp_compute_critical_path` | Identify priority tasks | Initialization, Step 1 |
| `varp_check_freshness` | Verify doc currency | Step 2 |
| `varp_resolve_docs` | Load docs for task scope | Step 3 |
| `varp_verify_capabilities` | Check file changes vs declared scope | Step 8 |
| `varp_derive_restart_strategy` | Determine failure recovery approach | Step 10 |
| `varp_invalidation_cascade` | Find transitively affected components | Step 13 |
| `varp_detect_hazards` | Analyze data dependencies between tasks | As needed |
