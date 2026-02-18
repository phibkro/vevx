# Enforcement

Capability verification and failure recovery for task execution.

## Tools

| Tool | Function | Purpose |
|------|----------|---------|
| `varp_verify_capabilities` | `verifyCapabilities()` | Check file modifications stay within declared write scope |
| `varp_derive_restart_strategy` | `deriveRestartStrategy()` | Determine recovery action after task failure |

## Capability Verification

Given a list of modified file paths and a task's declared `touches` (reads/writes), checks that every modified file falls within a component declared as a write target. Returns violations for out-of-scope writes.

Paths are resolved to absolute paths against the manifest directory. Component ownership uses longest-prefix matching via `findOwningComponent()` from shared.

## Restart Strategy

Given a failed task and the current execution state (completed/dispatched task IDs), derives one of three strategies:

| Strategy | When | Action |
|----------|------|--------|
| `isolated_retry` | No downstream tasks affected | Retry the failed task alone |
| `cascade_restart` | Downstream tasks depend on failed task's writes | Restart failed task + all transitively affected |
| `escalate` | Circular dependencies or unresolvable conflicts | Surface to user for manual intervention |
