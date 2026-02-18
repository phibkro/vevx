---
name: status
description: Generate a concise snapshot of the current Varp-managed project state
---

# /varp:status -- Project State Report

You are a project state reporter. Generate a concise, accurate snapshot of the current Varp-managed project.

## Protocol

### Step 1: Load Manifest

Call `varp_read_manifest` to get the component registry and dependency graph.
Call `varp_render_graph` to generate a dependency visualization.

If the manifest fails to parse, report the error and stop.

### Step 2: Check Doc Freshness

Call `varp_check_freshness` to get staleness status for all component docs.
Note the `total_stale` count from `varp_watch_freshness` (no `since` param) for the summary line.

### Step 3: Check for Active Plan

Look for active plans in `~/.claude/projects/<project>/memory/plans/`. If a directory exists there, call `varp_parse_plan` with the path to its `plan.xml`.

### Step 4: Analyze Active Plan (if present)

If an active plan exists:

1. Extract the task list from the parsed plan
2. Call `varp_detect_hazards` with the plan's tasks to identify data dependencies
3. Call `varp_compute_critical_path` with the plan's tasks to find the longest dependency chain
4. If `log.xml` exists alongside the plan, call `varp_parse_log` to get structured execution metrics

### Step 5: Format Report

Output a structured report with these sections:

```
## Component Registry

| Component | Path | Dependencies | Stability | Tags |
|-----------|------|-------------|-----------|------|
| <name>    | <path> | <deps or "none"> | <stability or "—"> | <tags or "—"> |

## Dependency Graph

```mermaid
<output from varp_render_graph>
```

## Environment Requirements

(Only show this section if any component has an `env` field.)

| Component | Variables |
|-----------|-----------|
| <name>    | <env vars, comma-separated> |

## Doc Freshness

<N stale docs total>

| Component | Interface Doc | Internal Doc | Status |
|-----------|--------------|--------------|--------|
| <name>    | <last_modified> | <last_modified> | <fresh/stale> |

## Active Plan: <feature name> (if any)

**Status:** in-progress | in-review | blocked
**Created:** <date>
**Tasks:** <completed>/<total>

### Hazards
- <RAW/WAR/WAW>: task <id> -> task <id> on <component>

### Critical Path
Tasks: <id> -> <id> -> <id>
Critical path length: <n> tasks

## Active Plans

| Plan | Created | Tasks |
|------|---------|-------|
| <name> | <date> | <completed>/<total> |
```

If there is no active plan, omit the Active Plan section and note "No active plan" in the Pipeline section.

## Tool Reference

| Tool | Purpose |
|------|---------|
| `varp_read_manifest` | Load component registry and dependency graph |
| `varp_check_freshness` | Get doc staleness per component |
| `varp_parse_plan` | Parse plan.xml into typed structure |
| `varp_render_graph` | Generate dependency graph diagram |
| `varp_watch_freshness` | Quick stale-doc count |
| `varp_parse_log` | Parse execution log for plan progress |
| `varp_detect_hazards` | Identify RAW/WAR/WAW between tasks |
| `varp_compute_critical_path` | Find longest dependency chain |
