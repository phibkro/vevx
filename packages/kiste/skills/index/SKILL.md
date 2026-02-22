---
name: index
description: Initialize or rebuild the kiste artifact index for the current repository
allowed-tools: Bash, mcp__kiste__*
---

# /kiste:index -- Index Repository

You manage the kiste artifact index for the current git repository.

## Protocol

### Step 1: Check initialization

Check if `.kiste/` directory exists.

- **If not:** Run `kiste init` to create the config and index directory, then proceed to full index.
- **If yes:** Proceed to Step 2.

### Step 2: Determine index mode

Ask: has the user requested a full rebuild, or is this a routine update?

- **Full rebuild** (`--rebuild`): Drops existing index, re-indexes all commits from scratch. Use when the index is corrupted or tags need recomputation.
- **Incremental** (default): Only indexes commits since the last indexed SHA. Fast for routine updates.

### Step 3: Run indexer

```bash
bun packages/kiste/dist/Cli.js index [--rebuild]
```

### Step 4: Report results

Call `kiste_list_tags` to show the current tag landscape. Output:

```
## Index Summary

- **Commits indexed:** <n>
- **Artifacts:** <alive> alive, <deleted> deleted
- **Tags:** <count> distinct

### Top Tags

| Tag | Artifacts |
|-----|-----------|
| ... | ...       |
```
