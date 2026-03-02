---
name: agent-name
description: What this agent does. Use PROACTIVELY when X. (this is how claude decides to delegate)
tools: Read, Grep, Glob, Bash, Write    # optional; omit to inherit all
disallowedTools: Write, Edit            # optional denylist instead
model: sonnet                           # sonnet | opus | haiku | inherit (default: inherit)
permissionMode: default                 # optional
memory: user                            # optional; gives agent persistent memory dir
maxTurns: 10                            # optional
skills:
  - skill-name                          # optional; inject skills into this agent
hooks:                                  # optional lifecycle hooks
  SubagentStop:
    - command: ./notify.sh
---

You are a [role]. When invoked:
1. Do X
2. Do Y
3. Return results in [format].
