---
name: status
description: Generate a concise snapshot of the current Varp-managed project state
allowed-tools: mcp__varp__*
---

# /varp:status -- Project State Report

You are a project state reporter. Generate a concise, accurate snapshot of the current Varp-managed project.

## Protocol

### Step 1: Health check

Call `varp_health mode=all` to get manifest, doc freshness, and lint results in one call.
Call `varp_render_graph` to generate a dependency visualization.

If the manifest fails to parse, report the error and stop.

### Step 2: Coupling health

Call `varp_coupling mode=hotspots` to detect hidden coupling — component pairs that frequently co-change in git history but have no import relationship.

If no edges are returned (empty repo or insufficient history), skip the coupling section silently.

### Step 3: Check for active plan

Look for active plans in `~/.claude/projects/<project>/memory/plans/`. If a directory exists there, call `varp_parse_plan` with the path to its `plan.xml`.

### Step 4: Analyze active plan (if present)

If an active plan exists:

1. Extract the task list from the parsed plan
2. Call `varp_schedule mode=all` with the plan's tasks to get hazards and critical path in one call
3. If `log.xml` exists alongside the plan, call `varp_parse_log` to get structured execution metrics

### Step 5: Format report

Output a structured report with these sections:

````
## Component Registry

| Component | Path | Dependencies | Stability | Tags |
|-----------|------|-------------|-----------|------|
| <name>    | <path> | <deps or "none"> | <stability or "—"> | <tags or "—"> |

## Dependency Graph

```mermaid
<output from varp_render_graph>
````

## Environment Requirements

(Only show this section if any component has an `env` field.)

| Component | Variables                   |
| --------- | --------------------------- |
| <name>    | <env vars, comma-separated> |

## Doc Freshness

<N stale docs total>

| Component | Interface Doc   | Internal Doc    | Status        |
| --------- | --------------- | --------------- | ------------- |
| <name>    | <last_modified> | <last_modified> | <fresh/stale> |

## Coupling Health

<N hidden coupling hotspots>

| Component Pair | Behavioral Weight | Action                                        |
| -------------- | ----------------- | --------------------------------------------- |
| <A> ↔ <B>      | <weight>          | Consider adding `deps` or co-locating changes |

(Omit this section if no hotspots found or insufficient git history.)

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

| Plan   | Created | Tasks               |
| ------ | ------- | ------------------- |
| <name> | <date>  | <completed>/<total> |

```

If there is no active plan, omit the Active Plan section and note "No active plan" in the Pipeline section.

## Tool Reference

| Tool | Purpose |
|------|---------|
| `varp_health` | Manifest parsing, doc freshness, lint (mode=all) |
| `varp_coupling` | Coupling analysis (mode=hotspots for hidden coupling) |
| `varp_schedule` | Hazards, waves, critical path (mode=all) |
| `varp_parse_plan` | Parse plan.xml into typed structure |
| `varp_render_graph` | Generate dependency graph diagram |
| `varp_watch_freshness` | Quick stale-doc count |
| `varp_parse_log` | Parse execution log for plan progress |
```
