#!/bin/bash
# Varp session-start hook
# Injects project health summary and graph context into session

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# ── Save session baseline for stop hook ──
mkdir -p .varp
git rev-parse HEAD > .varp/session-head 2>/dev/null || true

# ── Graph-aware summary ──
# Try the built CLI first (fast, includes coupling diagnostics)
# Fall back to basic manifest parsing if CLI not available

PKG_ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
CLI_PATH="${PKG_ROOT}/dist/cli.js"
if [ -x "$(command -v bun)" ] && [ -f "$CLI_PATH" ]; then
  if summary=$(bun run "$CLI_PATH" summary 2>/dev/null); then
    echo "$summary"
  else
    # CLI failed — fall back to basic info
    comp_count=$(grep -cE '^[a-zA-Z_][a-zA-Z0-9_-]*:' "$MANIFEST" 2>/dev/null || echo 0)
    comp_count=$((comp_count - 1))  # subtract 'varp:' key
    echo "Varp project: ${comp_count} components (run 'turbo build' for graph context)"
  fi
else
  comp_count=$(grep -cE '^[a-zA-Z_][a-zA-Z0-9_-]*:' "$MANIFEST" 2>/dev/null || echo 0)
  comp_count=$((comp_count - 1))
  echo "Varp project: ${comp_count} components (build CLI for graph context)"
fi

# ── Active plans ──
project_key="${PWD//\//-}"
plans_dir="$HOME/.claude/projects/${project_key}/memory/plans"
if [ -d "$plans_dir" ]; then
  for plan_dir in "$plans_dir"/*/; do
    if [ -d "$plan_dir" ] && [ -f "${plan_dir}plan.xml" ]; then
      echo "Active plan: $(basename "$plan_dir")"
    fi
  done
fi

# ── Cost tracking status ──
statusline_status="✗"
otel_status="✗"
otel_detail=""

if [ -f "/tmp/claude/varp-cost.json" ]; then
  statusline_status="✓"
fi

if [ "${CLAUDE_CODE_ENABLE_TELEMETRY:-0}" = "1" ]; then
  otel_status="✓"
  exporter="${OTEL_METRICS_EXPORTER:-otlp}"
  endpoint="${OTEL_EXPORTER_OTLP_ENDPOINT:-}"
  if [ -n "$endpoint" ]; then
    otel_detail=" (${exporter} → ${endpoint})"
  else
    otel_detail=" (${exporter})"
  fi
fi

echo "Cost tracking: statusline ${statusline_status} | otel ${otel_status}${otel_detail}"
