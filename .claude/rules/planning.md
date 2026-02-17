# Planning in Varp Projects

When entering plan mode (EnterPlanMode), always start by loading manifest context:

1. Call `varp_read_manifest` to get the component registry and dependency graph
2. Call `varp_check_freshness` to see which docs are stale
3. Use this to inform your plan:
   - Identify which components the work touches (reads vs writes)
   - Check if writes cross component boundaries (suggests task splitting)
   - Note stale docs that may need updating as part of the work
   - Check component `stability` — experimental components need more discovery budget

Your plan file should include a **Components** section listing affected components
and their read/write relationship to the work. This replaces ad-hoc file lists.

## When to escalate to /varp:plan

Use `/varp:plan` instead of plan mode when ANY of these apply:
- The work touches 3+ components with write dependencies between them
- Parallel execution would meaningfully speed up the work
- You need formal contracts (preconditions/postconditions with verify commands)
- The user explicitly asks for a varp plan

For everything else, plan mode with manifest context is sufficient.
