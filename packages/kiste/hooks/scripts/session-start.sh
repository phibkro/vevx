#!/usr/bin/env bash
# kiste session-start hook — incremental index on session start
# Only runs if .kiste/ directory exists (initialized repo)
set -euo pipefail

KISTE_DIR=".kiste"

if [ ! -d "$KISTE_DIR" ]; then
  exit 0
fi

# Run incremental index to pick up any new commits since last session
if command -v bun >/dev/null 2>&1; then
  bun packages/kiste/dist/Cli.js index 2>/dev/null || true
fi

# Print summary for context
if [ -f "$KISTE_DIR/index.sqlite" ]; then
  COMMITS=$(sqlite3 "$KISTE_DIR/index.sqlite" "SELECT COUNT(*) FROM commits" 2>/dev/null || echo "?")
  ARTIFACTS=$(sqlite3 "$KISTE_DIR/index.sqlite" "SELECT COUNT(*) FROM artifacts WHERE alive=1" 2>/dev/null || echo "?")
  TAGS=$(sqlite3 "$KISTE_DIR/index.sqlite" "SELECT COUNT(DISTINCT tag) FROM artifact_tags" 2>/dev/null || echo "?")
  echo "kiste: ${COMMITS} commits, ${ARTIFACTS} artifacts, ${TAGS} tags indexed"
fi
