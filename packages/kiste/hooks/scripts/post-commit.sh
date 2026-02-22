#!/usr/bin/env bash
# kiste post-commit hook — incremental index after git commits
# Fires on PostToolUse:Bash, checks if the command was a git commit
set -euo pipefail

KISTE_DIR=".kiste"

if [ ! -d "$KISTE_DIR" ]; then
  exit 0
fi

# Read stdin (JSON context from Claude Code)
input=$(cat)

# Check if the Bash command was a git commit
if ! echo "$input" | grep -q 'git commit'; then
  exit 0
fi

if command -v bun >/dev/null 2>&1; then
  bun packages/kiste/dist/Cli.js index 2>/dev/null || true
fi
