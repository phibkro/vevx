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
> "auth/session.ts has hidden coupling with db/migrations/024.sql (co-change weight 0.87, no import link). Changes here often require coordinated changes there."

### Step 4: Recommendations

Based on the coupling analysis:
- If hidden coupling exists: suggest checking those files for needed updates
- If modifying a stable interface: note that dependents are unlikely to break
- If adding new cross-component imports: note whether this creates a new coupling relationship

### Output format

Keep output concise. The user is mid-task — give them what they need to make decisions, not a full audit report.

Format:
- Component-level coupling classification for each affected pair
- File-level top 5 co-changers for modified files
- Actionable recommendations (check these files, safe to proceed, etc.)
