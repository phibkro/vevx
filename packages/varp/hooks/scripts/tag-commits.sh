#!/usr/bin/env bash
# tag-commits.sh — PreToolUse:Bash hook
# Adds tags: line to git commit messages based on varp.yaml components
#
# Fires on every Bash call. Cheap grep checks exit early on non-commits.
# When it IS a git commit -m, delegates to TypeScript for manifest lookup.
set -euo pipefail

# Cheap early exits (no bun invocation needed)
[ -f "varp.yaml" ] || exit 0

input=$(cat)

# Not a git commit
echo "$input" | grep -q 'git commit' || exit 0

# Amend — skip (original tags already there)
echo "$input" | grep -q '\-\-amend' && exit 0

# Tags already present in message
echo "$input" | grep -q 'tags:' && exit 0

# Delegate to TypeScript for manifest lookup and command rewriting
echo "$input" | bun packages/varp/hooks/scripts/tag-commits-impl.ts 2>/dev/null || exit 0
