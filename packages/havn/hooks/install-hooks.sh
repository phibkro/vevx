#!/bin/bash
# SessionStart hook: install git pre-commit hook if not present.
# Idempotent — skips if already installed.

# Only run in git repos
git rev-parse --git-dir &>/dev/null || exit 0

mkdir -p .githooks

# Install pre-commit if missing or outdated
src="${CLAUDE_PLUGIN_ROOT}/hooks/pre-commit.sh"
dst=".githooks/pre-commit"

if [ ! -f "$dst" ] || ! grep -q "installed by havn" "$dst" 2>/dev/null; then
  cp "$src" "$dst"
  chmod +x "$dst"
  echo "havn: installed pre-commit hook"
fi

# Ensure hooksPath is set
current=$(git config core.hooksPath 2>/dev/null)
if [ "$current" != ".githooks" ]; then
  git config core.hooksPath .githooks
  echo "havn: set core.hooksPath to .githooks"
fi
