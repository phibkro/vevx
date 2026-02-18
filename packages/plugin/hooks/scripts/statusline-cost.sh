#!/bin/bash
# Persist statusline JSON to a known location for cost tracking.
# Configured as statusLine.command in .claude/settings.json.
# The execute skill reads snapshots before/after tasks to compute cost deltas.
cat > /tmp/claude/varp-cost.json
