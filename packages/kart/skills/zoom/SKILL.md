---
name: zoom
description: Use when exploring unfamiliar code, understanding module contracts, or checking what else might break before modifying a file. Triggers on code navigation, impact assessment, "what does this module do", "what changes with this file"
---

# /varp:zoom -- Progressive Code Disclosure

Use kart's MCP tools to manage context budget when navigating code.

## Quick Reference

| Question | Tool | Notes |
|----------|------|-------|
| "What does this module expose?" | `kart_zoom` level 0 | Default. Exported symbols + signatures + doc comments |
| "How does this module work internally?" | `kart_zoom` level 1 | All symbols including non-exported |
| "I need the full implementation" | `kart_zoom` level 2 or `read_file` | Full file content |
| "What does this directory expose?" | `kart_zoom` on directory | Level-0 per file, no-export files omitted |
| "Find a symbol by name" | `kart_find` | Fast oxc-parser scan, filter by kind/export |
| "Search for a pattern" | `kart_search` | Ripgrep-backed, gitignore-aware |
| "What files are in this dir?" | `kart_list` | Recursive, glob-filterable |
| "What else changes when I touch this?" | `kart_cochange` | Behavioral coupling from git history |
| "What breaks if I change this?" | `kart_impact` | Transitive callers via LSP |
| "What does this depend on?" | `kart_deps` | Transitive callees via LSP |
| "Replace a symbol definition" | `kart_replace` | AST-aware with syntax validation |
| "Add code after/before a symbol" | `kart_insert_after` / `kart_insert_before` | Syntax-validated insertion |

## When to Use Each Level

```dot
digraph zoom_decision {
  "Need to understand a file?" [shape=diamond];
  "Will you modify it?" [shape=diamond];
  "Need implementation details?" [shape=diamond];
  "kart_zoom level 0" [shape=box];
  "kart_cochange + kart_zoom level 1" [shape=box];
  "kart_zoom level 2" [shape=box];

  "Need to understand a file?" -> "Will you modify it?" [label="yes"];
  "Need to understand a file?" -> "Need implementation details?" [label="no, just using it"];
  "Need implementation details?" -> "kart_zoom level 0" [label="no"];
  "Need implementation details?" -> "kart_zoom level 2" [label="yes"];
  "Will you modify it?" -> "kart_cochange + kart_zoom level 1" [label="yes"];
}
```

## Protocol

### Exploring unfamiliar code

1. Start with `kart_zoom` level 0 on the file or directory — see the public contract
2. If you need internals, escalate to level 1
3. Only use level 2 when you need to read or modify the implementation

### Before modifying a file

1. `kart_cochange` on the file — check behavioral coupling neighbors
2. `kart_zoom` level 1 on the file — understand all symbols
3. Review top co-change neighbors before committing — they may need coordinated changes

### kart vs serena

| serena | kart |
|--------|------|
| `find_symbol` — locate a symbol by name | `kart_find` — workspace-wide symbol search by name/kind/export |
| `find_referencing_symbols` — direct references | `kart_impact` — transitive callers (blast radius) |
| `get_symbols_overview` — flat symbol list | `kart_zoom` level 0 — exported symbols with signatures and doc comments |
| `read_file` — full file content | `kart_zoom` level 2 — same content, structured response |
| `search_for_pattern` — regex search | `kart_search` — ripgrep-backed text search |
| `replace_symbol_body` — replace a symbol | `kart_replace` — replace with syntax validation + diagnostics |
| `insert_after_symbol` / `insert_before_symbol` | `kart_insert_after` / `kart_insert_before` |

kart is TypeScript-focused and lightweight (oxc-parser + oxlint). serena is cross-language with full LSP integration. For TypeScript projects, kart provides equivalent functionality with lower overhead.

## Common Mistakes

**Reading full files by default.** Start at level 0. Most of the time you only need the public contract.

**Skipping cochange before edits.** Files with high behavioral coupling but no import relationship are invisible to static analysis. `kart_cochange` surfaces these.

**Using level 2 instead of read_file.** They return the same content. Use whichever is more natural for your workflow — level 2 adds no value over `read_file`.
