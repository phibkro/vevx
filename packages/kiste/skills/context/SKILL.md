---
name: context
description: Gather relevant files and history from kiste before starting a task
allowed-tools: mcp__kiste__*
---

# /kiste:context -- Task Context Briefing

You gather relevant context from the kiste artifact index to inform the current task. This skill turns a task description into a focused set of files, tags, and commit history.

## Protocol

### Step 1: Extract search terms

From the user's task description or current conversation, identify:

- **Keywords** — domain terms, feature names, module names (e.g. "auth", "rate limiting", "indexer")
- **File paths** — any specific files already mentioned
- **Scope** — conventional commit scopes that might be relevant (e.g. "kiste", "varp", "audit")

### Step 2: Survey the tag landscape

Call `kiste_list_tags` to see what tags exist. Match your keywords against available tags. This avoids searching for tags that don't exist.

### Step 3: Search by multiple signals

Run these in parallel where possible:

1. **Tag search** — For each matching tag, call `kiste_list_artifacts` with the tag filter (limit 10). This finds files semantically grouped with the task domain.

2. **Full-text search** — Call `kiste_search` with 2-3 keyword variations of the task description (limit 10 each). This finds commits whose messages describe related work.

3. **Provenance** — If specific files are already known, call `kiste_get_provenance` to understand their history and what else changed alongside them.

### Step 4: Rank and deduplicate

From the combined results, build a ranked list of relevant files:

- Files appearing in multiple signals (tag match + commit search) rank highest
- Files with recent commits rank higher than stale ones
- Dead artifacts (alive=false) are excluded unless explicitly relevant (renames, deletions)

### Step 5: Present context briefing

Output a structured briefing:

```
## Context Briefing: <task summary>

### Relevant Files (<count>)

| File | Tags | Last Commit | Relevance |
|------|------|-------------|-----------|
| path/to/file.ts | tag1, tag2 | feat: description (sha) | tag match + commit |

### Recent Activity

| Commit | Scope | Files | Date |
|--------|-------|-------|------|
| message | scope | <count> files | timestamp |

### Suggested Starting Points

1. **<file>** — <why this is relevant>
2. **<file>** — <why this is relevant>
```

Keep the briefing concise — aim for 5-10 relevant files, not an exhaustive dump. The goal is to give the agent (or user) enough context to start working without reading everything.

## When to Use

- Before implementing a feature — find existing code in the domain
- Before debugging — find recent changes that might have introduced the issue
- Before refactoring — understand what files are coupled and their change history
- When onboarding to an unfamiliar area — survey the landscape

## Tool Reference

| Tool | Purpose |
|------|---------|
| `kiste_list_tags` | Survey available tags |
| `kiste_list_artifacts` | Find files by tag |
| `kiste_search` | FTS over commit messages |
| `kiste_get_provenance` | Commit history for a file |
| `kiste_get_artifact` | Full detail for a specific file |
| `kiste_get_cochange` | Files that frequently change alongside a given file |
