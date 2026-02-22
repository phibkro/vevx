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

### Step 2: Per-file neighborhood

For each modified file, call `varp_coupling mode=neighborhood file=<path>`. This returns:

- **neighbors**: files that co-change with this file, sorted by weight
- **trends**: complexity trend direction (increasing/decreasing/stable) for each neighbor
- **component**: the owning component

Flag hidden coupling prominently — neighbors with high co-change but `hasImportRelation: false`:

> "auth/session.ts has hidden coupling with db/migrations/024.sql (co-change weight 0.87, no import link, trend: increasing). Changes here often require coordinated changes there."

### Step 3: Component-level matrix

Call `varp_coupling mode=matrix component=<name>` for each affected component. This reveals:

- **hidden_coupling**: High co-change but no import relationship — implicit dependencies to investigate.
- **explicit_module**: High co-change and high imports — expected, well-documented coupling.
- **stable_interface**: High imports but low co-change — good abstraction boundaries.

### Step 4: Recommendations

Based on the coupling analysis:

- If hidden coupling exists: suggest checking those files for needed updates, note trend direction
- If modifying a stable interface: note that dependents are unlikely to break
- If adding new cross-component imports: note whether this creates a new coupling relationship
- If trends are increasing: flag as growing coupling that may need architectural attention

### Output format

Keep output concise. The user is mid-task — give them what they need to make decisions, not a full audit report.

Format:

- Per-file neighborhood (top 5 co-changers with trend sparklines)
- Component-level coupling classification for each affected pair
- Actionable recommendations (check these files, safe to proceed, etc.)
