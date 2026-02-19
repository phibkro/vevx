# Superpowers Companion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement ADR-003 Phase 1 (graph-aware hooks) and Phase 2 (positioning), making varp a graph-aware companion to superpowers by injecting coupling diagnostics into the session lifecycle.

**Architecture:** Add a `varp summary` CLI command that computes a compact project health digest (coupling hotspots, freshness, component health). SessionStart calls it to inject graph context. PostToolUse reads cached summary data. A new `/varp:coupling` skill exposes on-demand diagnostics. Stop hook summarizes session impact.

**Tech Stack:** TypeScript (ESM), Bun (runtime/test), bash (hooks), `@varp/core/lib` (analysis functions)

---

## Context

### What exists today

| Location | Contains |
|----------|----------|
| `packages/core/src/analysis/` | Co-change parser, coupling matrix, hotspot scoring, incremental cache, CodebaseGraph builder |
| `packages/cli/src/coupling.ts` | `varp coupling` — full matrix, hotspots, file-level edges, component profiles |
| `packages/plugin/hooks/scripts/session-start.sh` | Component listing, stale doc check, broken link check, cost tracking |
| `packages/plugin/hooks/scripts/freshness-track.sh` | PostToolUse: identifies owning component of modified file |
| `packages/plugin/hooks/hooks.json` | SessionStart (command), SubagentStart (command), Stop (prompt: lint), PostToolUse (freshness-track + auto-format) |
| `packages/plugin/skills/` | 5 skills: init, status, plan, execute, review |
| `packages/core/src/lib.ts` | Exports `findHiddenCoupling`, `buildCodebaseGraph`, `fileNeighborhood`, `computeHotspots`, `countLines`, etc. |
| `.varp/co-change.json` | Cached co-change graph (incremental, keyed by HEAD SHA) |

### What we're building

1. **`varp summary`** CLI command — compact health digest (coupling hotspots, freshness, component stability). Also writes `.varp/summary.json` for hook consumption.
2. **SessionStart enhancement** — call `varp summary` to inject graph context into session.
3. **PostToolUse enhancement** — read `.varp/summary.json` to note coupling neighbors when modifying hotspot files.
4. **`/varp:coupling` skill** — in-session coupling diagnostic via MCP tools.
5. **Stop hook enhancement** — session impact summary (components modified, coupling implications).
6. **Documentation** — update plugin description, README, CLAUDE.md positioning.

### What we're NOT building

- Superpowers plan ingestion (Phase 3 — needs superpowers plan format stability)
- Knowledge maps / developer affinity (Phase 4 — future signal layer)
- Wave dispatcher changes (execution layer is separate work)
- Any changes to `@varp/core` analysis algorithms (they're complete)

---

### Task 1: Add `varp summary` CLI subcommand

The foundation. All hooks will consume this output.

**Files:**
- Create: `packages/cli/src/summary.ts`
- Create: `packages/cli/src/__tests__/summary.test.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/completions.ts`

**Step 1: Write the failing test**

Create `packages/cli/src/__tests__/summary.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { resolve } from "path";

import { computeSummary, type ProjectSummary } from "../summary.js";

// Use the repo's own varp.yaml as fixture
const MANIFEST = resolve(import.meta.dir, "../../../../varp.yaml");

describe("computeSummary", () => {
  it("returns component count and names", () => {
    const summary = computeSummary(MANIFEST);
    expect(summary.components.length).toBeGreaterThan(0);
    expect(summary.components.every((c) => c.name && c.path)).toBe(true);
  });

  it("includes freshness counts", () => {
    const summary = computeSummary(MANIFEST);
    expect(typeof summary.stale_docs).toBe("number");
    expect(typeof summary.total_docs).toBe("number");
    expect(summary.stale_docs).toBeLessThanOrEqual(summary.total_docs);
  });

  it("includes coupling hotspots (may be empty for small repos)", () => {
    const summary = computeSummary(MANIFEST);
    expect(Array.isArray(summary.coupling_hotspots)).toBe(true);
    for (const h of summary.coupling_hotspots) {
      expect(h.pair).toHaveLength(2);
      expect(typeof h.behavioral_weight).toBe("number");
    }
  });

  it("includes hotspot files map", () => {
    const summary = computeSummary(MANIFEST);
    expect(typeof summary.hotspot_files).toBe("object");
    // hotspot_files maps file paths to their coupling neighbors
    for (const [file, neighbors] of Object.entries(summary.hotspot_files)) {
      expect(typeof file).toBe("string");
      expect(Array.isArray(neighbors)).toBe(true);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/cli/src/__tests__/summary.test.ts`
Expected: FAIL — `../summary.js` module not found

**Step 3: Write implementation**

Create `packages/cli/src/summary.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  buildCouplingMatrix,
  checkFreshness,
  findHiddenCoupling,
  parseManifest,
  scanCoChangesWithCache,
  scanImports,
  type CouplingEntry,
  type Manifest,
} from "@varp/core/lib";

import { DEFAULT_MANIFEST, parseFlag } from "./args.js";

// ── Types ──

export interface ComponentSummary {
  name: string;
  path: string;
  stability: string;
  tags: string[];
}

export interface ProjectSummary {
  components: ComponentSummary[];
  stale_docs: number;
  total_docs: number;
  coupling_hotspots: CouplingHotspot[];
  /** Map of file path → coupling neighbor descriptions (for PostToolUse consumption) */
  hotspot_files: Record<string, string[]>;
}

interface CouplingHotspot {
  pair: [string, string];
  behavioral_weight: number;
}

// ── Pure computation ──

export function computeSummary(manifestPath: string): ProjectSummary {
  const absPath = resolve(manifestPath);
  const manifestDir = dirname(absPath);
  const manifest = parseManifest(absPath);

  // Components
  const components: ComponentSummary[] = Object.entries(manifest.components).map(
    ([name, comp]) => ({
      name,
      path: comp.path,
      stability: comp.stability ?? "unknown",
      tags: comp.tags ?? [],
    }),
  );

  // Freshness
  const freshness = checkFreshness(absPath);
  let stale = 0;
  let total = 0;
  for (const comp of freshness.components) {
    for (const doc of comp.docs) {
      total++;
      if (doc.stale) stale++;
    }
  }

  // Coupling (graceful degradation if no git history)
  let couplingHotspots: CouplingHotspot[] = [];
  const hotspotFiles: Record<string, string[]> = {};

  try {
    const coChange = scanCoChangesWithCache(manifestDir);
    if (coChange.edges.length > 0) {
      const imports = scanImports(manifest, manifestDir);
      const matrix = buildCouplingMatrix(coChange, imports, manifest, {
        repo_dir: manifestDir,
      });
      const hidden = findHiddenCoupling(matrix);

      couplingHotspots = hidden.slice(0, 5).map((h) => ({
        pair: h.pair as [string, string],
        behavioral_weight: h.behavioral_weight,
      }));

      // Build file-level hotspot map from hidden coupling edges
      for (const edge of coChange.edges) {
        const [a, b] = edge.files;
        // Only include files with above-threshold co-change weight
        if (edge.weight >= matrix.behavioral_threshold) {
          if (!hotspotFiles[a]) hotspotFiles[a] = [];
          if (!hotspotFiles[b]) hotspotFiles[b] = [];
          hotspotFiles[a].push(`${b} (${edge.weight.toFixed(2)})`);
          hotspotFiles[b].push(`${a} (${edge.weight.toFixed(2)})`);
        }
      }
    }
  } catch {
    // No git history or shallow clone — skip coupling
  }

  return { components, stale_docs: stale, total_docs: total, coupling_hotspots: couplingHotspots, hotspot_files: hotspotFiles };
}

// ── Formatting ──

function formatText(summary: ProjectSummary): string {
  const lines: string[] = [];

  // Components
  const compNames = summary.components.map((c) => c.name).join(", ");
  lines.push(`Components (${summary.components.length}): ${compNames}`);

  // Freshness
  if (summary.stale_docs > 0) {
    lines.push(`Docs: ${summary.stale_docs}/${summary.total_docs} stale`);
  } else {
    lines.push(`Docs: ${summary.total_docs} total, all fresh`);
  }

  // Coupling hotspots
  if (summary.coupling_hotspots.length > 0) {
    lines.push(`Hidden coupling (${summary.coupling_hotspots.length}):`);
    for (const h of summary.coupling_hotspots) {
      lines.push(`  ${h.pair[0]} <-> ${h.pair[1]}  weight=${h.behavioral_weight.toFixed(2)}`);
    }
  }

  return lines.join("\n");
}

// ── Cache write ──

function writeSummaryCache(manifestPath: string, summary: ProjectSummary): void {
  const varpDir = join(dirname(resolve(manifestPath)), ".varp");
  mkdirSync(varpDir, { recursive: true });
  writeFileSync(join(varpDir, "summary.json"), JSON.stringify(summary, null, 2));
}

// ── CLI command ──

export function parseSummaryArgs(argv: string[]): { manifest: string; format: "text" | "json" } {
  let manifest = DEFAULT_MANIFEST;
  let format: "text" | "json" = "text";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--manifest" && argv[i + 1]) {
      manifest = argv[++i];
    } else if (arg === "--format" && argv[i + 1]) {
      format = argv[i + 1] === "json" ? "json" : "text";
      i++;
    } else if (arg === "--json") {
      format = "json";
    }
  }

  return { manifest, format };
}

export async function runSummaryCommand(argv: string[]): Promise<void> {
  const args = parseSummaryArgs(argv);
  const summary = computeSummary(args.manifest);

  // Always write cache for hook consumption
  writeSummaryCache(args.manifest, summary);

  if (args.format === "json") {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(formatText(summary));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/cli/src/__tests__/summary.test.ts`
Expected: PASS (4 tests)

**Step 5: Wire into CLI**

In `packages/cli/src/cli.ts`:
- Add import: `import { runSummaryCommand } from "./summary.js";`
- Add to HELP_TEXT commands section: `  summary             Project health digest (coupling, freshness, stability)`
- Add dispatch: `if (firstArg === "summary") return run(() => runSummaryCommand(restArgs));`

In `packages/cli/src/completions.ts`:
- Add `"summary"` to the command completions array.

**Step 6: Build and verify**

Run: `turbo build && bun test packages/cli/`
Expected: Build succeeds, all tests pass.

**Step 7: Commit**

```bash
git add packages/cli/src/summary.ts packages/cli/src/__tests__/summary.test.ts packages/cli/src/cli.ts packages/cli/src/completions.ts
git commit -m "feat(cli): add varp summary command for project health digest"
```

---

### Task 2: Enhance SessionStart hook with graph context

Replace the bash-native component parsing with a call to `varp summary`, injecting coupling diagnostics and health indicators into the session.

**Files:**
- Modify: `packages/plugin/hooks/scripts/session-start.sh`

**Step 1: Understand current behavior**

The current `session-start.sh` does:
1. Parse varp.yaml with grep/sed (component list)
2. Check for stale docs (find + timestamp compare)
3. Check for broken links (grep markdown links)
4. Check for active plans
5. Report cost tracking status

Lines 1-3 are replicated (better) by `varp summary`. Lines 4-5 are session-specific and should stay.

**Step 2: Modify the script**

Replace the component parsing, stale doc, and broken link sections with a CLI call. Keep plan detection and cost tracking. The new structure:

```bash
#!/bin/bash
# Varp session-start hook
# Injects project health summary and graph context into session

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# ── Graph-aware summary ──
# Try the built CLI first (fast, includes coupling diagnostics)
# Fall back to basic manifest parsing if CLI not available

CLI_PATH="packages/cli/dist/cli.js"
if [ -x "$(command -v bun)" ] && [ -f "$CLI_PATH" ]; then
  # CLI outputs: component count, freshness, coupling hotspots
  if summary=$(bun run "$CLI_PATH" summary 2>/dev/null); then
    echo "$summary"
  else
    # CLI failed — fall back to basic info
    comp_count=$(grep -cE '^[a-zA-Z_][a-zA-Z0-9_-]*:' "$MANIFEST" 2>/dev/null || echo 0)
    comp_count=$((comp_count - 1))  # subtract 'varp:' key
    echo "Varp project: ${comp_count} components (run 'turbo build' for graph context)"
  fi
else
  # No CLI available — basic info only
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
```

**Step 3: Test manually**

Run: `bash packages/plugin/hooks/scripts/session-start.sh`
Expected: Shows component count, freshness, coupling hotspots (if built), plan status, cost tracking.

Run: `shellcheck packages/plugin/hooks/scripts/session-start.sh`
Expected: No warnings.

**Step 4: Commit**

```bash
git add packages/plugin/hooks/scripts/session-start.sh
git commit -m "feat(hooks): inject graph context via varp summary in SessionStart"
```

---

### Task 3: Enhance PostToolUse hook with coupling awareness

When a file is modified, check if it's in a coupling hotspot. If so, note which files typically co-change with it.

**Files:**
- Modify: `packages/plugin/hooks/scripts/freshness-track.sh`

**Step 1: Understand the coupling data source**

`varp summary` writes `.varp/summary.json` which contains `hotspot_files`: a map of file paths to their coupling neighbors. The PostToolUse hook reads this cache — no CLI call, no Bun startup. Should be < 10ms.

**Step 2: Add coupling check to freshness-track.sh**

After the existing component scope detection (which outputs "Note: Modified file in component X scope"), add a coupling neighborhood check:

After the existing `while IFS= read -r line; do ... done < "$MANIFEST"` block (line 68), add:

```bash
# ── Coupling awareness ──
# Check .varp/summary.json for coupling hotspot data (written by varp summary)
SUMMARY_CACHE=".varp/summary.json"
if [ ! -f "$SUMMARY_CACHE" ]; then
  exit 0
fi

# Look up the file in hotspot_files using grep (fast, no jq dependency)
# summary.json has: "hotspot_files": { "path/to/file.ts": ["other.ts (0.72)", ...], ... }
file_check="${file_path_rel#./}"

# Extract the array value for this file key from JSON
# Pattern: "path/to/file.ts": ["neighbor1", "neighbor2"]
if neighbors=$(grep -o "\"${file_check}\": \[\"[^]]*\"\]" "$SUMMARY_CACHE" 2>/dev/null); then
  # Strip JSON syntax to get readable list
  neighbor_list=$(echo "$neighbors" | sed 's/.*\[//;s/\].*//;s/"//g;s/, */ /g')
  if [ -n "$neighbor_list" ]; then
    echo "Coupling note: files that typically co-change: ${neighbor_list}"
  fi
fi
```

**Step 3: Test manually**

Build CLI and run summary to populate cache:
```bash
turbo build && bun run packages/cli/dist/cli.js summary
```

Then simulate a PostToolUse event:
```bash
echo '{"tool_name":"Write","tool_input":{"file_path":"packages/core/src/analysis/matrix.ts"}}' | bash packages/plugin/hooks/scripts/freshness-track.sh
```
Expected: Shows component scope note + coupling note (if the file is in a hotspot).

Run: `shellcheck packages/plugin/hooks/scripts/freshness-track.sh`
Expected: No warnings.

**Step 4: Commit**

```bash
git add packages/plugin/hooks/scripts/freshness-track.sh
git commit -m "feat(hooks): add coupling awareness to PostToolUse hook"
```

---

### Task 4: Create `/varp:coupling` skill

On-demand coupling diagnostics via MCP tools, for when the user wants deeper insight mid-session.

**Files:**
- Create: `packages/plugin/skills/coupling/SKILL.md`

**Step 1: Write the skill**

Create `packages/plugin/skills/coupling/SKILL.md`:

```markdown
---
name: coupling
description: Surface coupling diagnostics for files or components you're working on
allowed-tools: mcp__varp__*
---

# /varp:coupling -- Coupling Diagnostic

You are a coupling analyst. Surface architectural coupling insights for the user's current work context.

## Protocol

### Step 1: Determine scope

If the user provided a file or component path as an argument, use that. Otherwise, check recent git changes:
- Run `git diff --name-only HEAD` (or `git diff --name-only` for unstaged) to find recently modified files.
- Use `varp_suggest_touches` with those file paths to identify affected components.

### Step 2: Run coupling analysis

Call `varp_coupling_matrix` with `component` set to each affected component. This reveals:
- **hidden_coupling**: High co-change but no import relationship — implicit dependencies to investigate.
- **explicit_module**: High co-change and high imports — expected, well-documented coupling.
- **stable_interface**: High imports but low co-change — good abstraction boundaries.

### Step 3: File-level neighborhood

For the specific files being worked on, call `varp_build_codebase_graph` with `with_coupling: true`, then report which files typically co-change with the modified files.

If the user is modifying a file in a hidden_coupling pair, flag this prominently:
> "⚠ `auth/session.ts` has hidden coupling with `db/migrations/024.sql` (co-change weight 0.87, no import link). Changes here often require coordinated changes there."

### Step 4: Recommendations

Based on the coupling analysis:
- If hidden coupling exists: suggest checking those files for needed updates
- If modifying a stable interface: note that dependents are unlikely to break
- If adding new cross-component imports: note whether this creates a new coupling relationship

### Output format

```
Coupling diagnostic for: <component or file list>

Component-level:
  <component> <-> <component>  <classification>  behavioral=<weight>

File-level (top 5 co-changers):
  <file> ↔ <file>  weight=<n>  <has-import|no-import>

Recommendations:
  - <actionable items>
```

Keep output concise. The user is mid-task — give them what they need to make decisions, not a full audit report.
```

**Step 2: Verify skill discovery**

Skills are auto-discovered from `packages/plugin/skills/`. The directory name `coupling` and frontmatter `name: coupling` make it accessible as `/varp:coupling`.

Check that the plugin still loads:
```bash
ls packages/plugin/skills/coupling/SKILL.md
```

**Step 3: Commit**

```bash
git add packages/plugin/skills/coupling/SKILL.md
git commit -m "feat(skills): add /varp:coupling for in-session coupling diagnostics"
```

---

### Task 5: Enhance Stop hook with session impact summary

Replace the current prompt-based Stop hook (which just runs lint) with a command hook that summarizes what changed during the session.

**Files:**
- Create: `packages/plugin/hooks/scripts/session-stop.sh`
- Modify: `packages/plugin/hooks/hooks.json`

**Step 1: Write the stop script**

Create `packages/plugin/hooks/scripts/session-stop.sh`:

```bash
#!/bin/bash
# Varp session-stop hook
# Summarizes session impact: modified components, coupling implications

set -euo pipefail

MANIFEST="varp.yaml"

# Exit silently if not a Varp project
if [ ! -f "$MANIFEST" ]; then
  exit 0
fi

# ── Modified files since session start ──
# Use git to find what changed (staged + unstaged + untracked in component paths)
modified_files=$(git diff --name-only HEAD 2>/dev/null || true)
staged_files=$(git diff --cached --name-only 2>/dev/null || true)
all_modified=$(printf '%s\n%s' "$modified_files" "$staged_files" | sort -u | grep -v '^$' || true)

if [ -z "$all_modified" ]; then
  exit 0
fi

# ── Map files to components ──
declare -A modified_components
while IFS= read -r line; do
  # Top-level key
  if echo "$line" | grep -qE '^[a-zA-Z_][a-zA-Z0-9_-]*:'; then
    current_key="${line%%:*}"
    [ "$current_key" = "varp" ] && current_key=""
    continue
  fi
  if [ -n "${current_key:-}" ] && echo "$line" | grep -qE '^  path:'; then
    comp_path="${line#  path:}"
    comp_path="${comp_path#"${comp_path%%[! ]*}"}"
    comp_path="${comp_path#./}"
    while IFS= read -r mf; do
      [ -z "$mf" ] && continue
      if echo "$mf" | grep -q "^${comp_path}"; then
        modified_components["$current_key"]=1
      fi
    done <<< "$all_modified"
  fi
done < "$MANIFEST"

if [ ${#modified_components[@]} -eq 0 ]; then
  exit 0
fi

comp_list=$(IFS=', '; echo "${!modified_components[*]}")
echo "Session impact: modified components: ${comp_list}"

# ── Coupling implications ──
SUMMARY_CACHE=".varp/summary.json"
if [ -f "$SUMMARY_CACHE" ]; then
  # Check if any modified component appears in coupling hotspots
  hotspot_warnings=()
  for comp in "${!modified_components[@]}"; do
    if grep -q "\"${comp}\"" "$SUMMARY_CACHE" 2>/dev/null; then
      # Check specifically in coupling_hotspots array
      if grep -oE "\"pair\": \[\"[^\"]*\", \"[^\"]*\"\]" "$SUMMARY_CACHE" 2>/dev/null | grep -q "\"${comp}\""; then
        hotspot_warnings+=("$comp")
      fi
    fi
  done
  if [ ${#hotspot_warnings[@]} -gt 0 ]; then
    echo "Coupling warning: modified components with hidden coupling: $(IFS=', '; echo "${hotspot_warnings[*]}")"
    echo "Consider running /varp:coupling to check for needed coordinated changes."
  fi
fi

# ── Freshness check ──
file_count=$(echo "$all_modified" | wc -l | tr -d ' ')
echo "Files modified: ${file_count}"
```

**Step 2: Update hooks.json**

Replace the Stop hook's prompt with a command hook, keeping the lint prompt as a secondary hook:

In `packages/plugin/hooks/hooks.json`, change the Stop section to:

```json
"Stop": [
  {
    "hooks": [
      {
        "type": "command",
        "command": "bash packages/plugin/hooks/scripts/session-stop.sh"
      },
      {
        "type": "prompt",
        "prompt": "If source files were modified during this turn, call varp_lint to check for stale docs, broken links, and missing deps. Fix any issues found."
      }
    ]
  }
]
```

**Step 3: Test manually**

Make a trivial change to a tracked file, then:
```bash
bash packages/plugin/hooks/scripts/session-stop.sh
```
Expected: "Session impact: modified components: ..." + optional coupling warning + file count.

Run: `shellcheck packages/plugin/hooks/scripts/session-stop.sh`
Expected: No warnings.

**Step 4: Commit**

```bash
git add packages/plugin/hooks/scripts/session-stop.sh packages/plugin/hooks/hooks.json
git commit -m "feat(hooks): add session impact summary to Stop hook"
```

---

### Task 6: Update documentation and positioning

Reflect ADR-003's companion positioning across project docs.

**Files:**
- Modify: `packages/plugin/.claude-plugin/plugin.json`
- Modify: `packages/plugin/.claude-plugin/marketplace.json` (if exists)
- Modify: `packages/plugin/hooks/README.md`
- Modify: `CLAUDE.md` (add companion positioning note)
- Modify: `docs/decisions/adr-003-superpowers-companion.md` (mark Phase 1 + 2 done)

**Step 1: Update plugin.json description**

Change description to: "Graph-aware project analysis: coupling diagnostics, dependency tracking, scope enforcement, and architectural drift detection for Claude Code"

**Step 2: Update hooks README**

Document the enhanced hook lifecycle:
- SessionStart: graph context injection (coupling hotspots, freshness, component health)
- PostToolUse: component scope tracking + coupling neighborhood awareness
- SubagentStart: convention injection for subagents
- Stop: session impact summary + lint prompt

**Step 3: Update CLAUDE.md**

Add a brief note in the Architecture section:
> Varp is a graph-aware companion to workflow plugins like superpowers. It provides structural awareness (coupling diagnostics, scope enforcement, contract verification) while deferring to workflow plugins for process methodology (TDD, brainstorming, code review). See ADR-003.

**Step 4: Mark ADR phases done**

In `docs/decisions/adr-003-superpowers-companion.md`, update Phase 1 items 6-9 as DONE and Phase 2 as DONE.

**Step 5: Commit**

```bash
git add packages/plugin/.claude-plugin/plugin.json packages/plugin/hooks/README.md CLAUDE.md docs/decisions/adr-003-superpowers-companion.md
git commit -m "docs: update positioning as graph-aware companion (ADR-003 Phase 1+2)"
```

---

### Task 7: Final verification

**Step 1: Build all packages**

Run: `turbo build`
Expected: All packages build successfully.

**Step 2: Run full test suite**

Run: `turbo test`
Expected: All tests pass.

**Step 3: Run lint**

Run: `turbo check`
Expected: Format + lint + build pass in all packages.

**Step 4: Run shellcheck on all hooks**

Run: `shellcheck packages/plugin/hooks/scripts/*.sh`
Expected: No warnings.

**Step 5: Run varp lint**

Run: `bun run packages/cli/dist/cli.js lint`
Expected: No new warnings.

**Step 6: Test the full hook lifecycle manually**

```bash
# SessionStart
bash packages/plugin/hooks/scripts/session-start.sh

# Simulate PostToolUse
echo '{"tool_name":"Write","tool_input":{"file_path":"packages/core/src/analysis/matrix.ts"}}' | bash packages/plugin/hooks/scripts/freshness-track.sh

# Stop
bash packages/plugin/hooks/scripts/session-stop.sh
```

Expected: Each hook produces relevant output without errors.
