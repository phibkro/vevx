---
paths:
  - "skills/**/*"
  - "hooks/**/*"
  - ".claude-plugin/**/*"
---

# Skills and Hooks

## Skills

Skills are prompt-based — SKILL.md content becomes conversation context when invoked. Skills load at session start — changes require restart.

**Spec**: Frontmatter fields, plugin.json format, and namespace rules change frequently. Search the web before modifying — see `docs/reference-urls.md` → Claude Code Skills.

**Project convention**: Skills in `skills/` are invoked as `/varp:skillname`. See existing SKILL.md files for the current pattern.

## Hooks

**Spec**: Hook event types, JSON schemas, and output format change frequently. Search the web before modifying — see `docs/reference-urls.md` → Claude Code Hooks.

**Project conventions** (stable):

- Use `#!/bin/bash` with `set -euo pipefail`
- Exit 0 silently when `varp.yaml` is missing (graceful skip for non-Varp projects)
- Parse YAML/JSON with grep/sed/awk only — no jq, python, or other runtime dependencies
- See existing scripts in `hooks/scripts/` for the current pattern
