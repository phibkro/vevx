---
paths:
  - "skills/**/*"
  - "hooks/**/*"
  - ".claude-plugin/**/*"
---

# Skills and Hooks

## Skills

Skills are prompt-based — SKILL.md content is injected into conversation context when invoked.

**Required YAML frontmatter:**
```yaml
---
name: skill-name
description: What this skill does and when to use it
---
```

Without frontmatter, Claude Code won't discover the skill. Skills load at session start — changes require restart.

**Plugin namespace**: Skills in `skills/` are invoked as `/varp:skillname` (plugin name from plugin.json).

**plugin.json format**: `"skills": "./skills/"` (directory path string, NOT an array of objects).

## Hooks

All hook scripts must:
- Use `#!/bin/bash` with `set -euo pipefail`
- Exit 0 silently when `varp.yaml` is missing (graceful skip for non-Varp projects)
- Parse YAML/JSON with grep/sed only — no jq, python, or other runtime dependencies
- PostToolUse hooks receive tool context as JSON on stdin (extract `file_path` from it)

**Hook types in use:**
- `SessionStart` — project overview on new session
- `SubagentStart` — static Varp awareness injection
- `PostToolUse` (Write|Edit) — freshness warning after component file edits
