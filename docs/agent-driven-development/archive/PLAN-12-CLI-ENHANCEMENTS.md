# Implementation Plan: CLI Enhancements

**Priority:** 🟢 MEDIUM - User experience improvements
**Scope:** apps/cli
**Agent Strategy:** cli-001 (expert in CLI UX)
**Estimated Time:** 4-6 hours
**Branch:** `feature/cli-enhancements`

## Overview

Improve CLI user experience with better configuration, output formatting, and developer-friendly features.

**Current State:**
- Basic CLI (audit command only)
- Configuration via flags only
- Text output only
- No watch mode

**Target State:**
- Rich configuration system (.code-audit.json + flags)
- Multiple output formats (text, JSON, markdown, HTML)
- Watch mode for continuous analysis
- Better error messages (already improved in PLAN-8)
- Shell completions

## Implementation Tasks

### Task 1: Configuration File Support [1-2h]

**Problem:** Currently requires flags for every option
**Solution:** Support `.code-audit.json` config file

**Create:** Config file schema

```json
{
  "$schema": "https://code-auditor.com/schema.json",
  "exclude": ["node_modules", "dist", "build"],
  "agents": {
    "correctness": { "enabled": true, "weight": 0.22 },
    "security": { "enabled": true, "weight": 0.22 },
    "performance": { "enabled": true, "weight": 0.13 },
    "maintainability": { "enabled": true, "weight": 0.15 },
    "edge-cases": { "enabled": true, "weight": 0.13 },
    "accessibility": { "enabled": true, "weight": 0.10 },
    "documentation": { "enabled": false, "weight": 0.05 }
  },
  "output": {
    "format": "text",
    "verbosity": "normal",
    "showPassed": false
  },
  "api": {
    "model": "claude-sonnet-3-5-20241022",
    "maxTokens": 100000
  }
}
```

**Priority order:**
1. CLI flags (highest)
2. `.code-audit.json` in current dir
3. `~/.code-audit.json` (user-level)
4. Defaults (lowest)

**Files to update:**
- Create `apps/cli/src/config.ts` - Config loader
- Update `apps/cli/src/cli.ts` - Merge config sources

**Tests:**
```typescript
test('loads config from file', () => {
  const config = loadConfig('.')
  expect(config.exclude).toContain('node_modules')
})

test('CLI flags override config file', () => {
  const config = mergeConfig(fileConfig, { exclude: ['dist'] })
  expect(config.exclude).toEqual(['dist'])
})
```

### Task 2: Output Formats [2-3h]

**Problem:** Text-only output limits integration options
**Solution:** Support JSON, markdown, HTML outputs

#### JSON Output (for CI/CD integration)
```bash
code-audit --format json src/ > results.json
```

```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "duration": 3.8,
  "overallScore": 7.5,
  "agents": [
    {
      "name": "correctness",
      "score": 8.5,
      "weight": 0.22,
      "findings": [...]
    }
  ]
}
```

#### Markdown Output (for documentation)
```bash
code-audit --format markdown src/ > AUDIT.md
```

Generates report similar to terminal but with markdown formatting.

#### HTML Output (for sharing)
```bash
code-audit --format html src/ > audit.html
```

Self-contained HTML with inline CSS, sortable table, collapsible findings.

**Implementation:**
- Create `apps/cli/src/formatters/json.ts`
- Create `apps/cli/src/formatters/markdown.ts`
- Create `apps/cli/src/formatters/html.ts`
- Update `apps/cli/src/cli.ts` - Use formatter based on --format flag

### Task 3: Watch Mode [1-2h]

**Problem:** Re-running on every change is tedious
**Solution:** Watch mode for continuous analysis

```bash
code-audit --watch src/
```

**Behavior:**
- Watches for file changes in target directory
- Re-runs audit on change (debounced 500ms)
- Shows incremental results
- Runs until Ctrl+C

**Implementation:**
- Use `chokidar` for file watching
- Debounce to avoid multiple runs on batch changes
- Clear terminal and re-render on each run

**Files to update:**
- Add `chokidar` dependency to `apps/cli/package.json`
- Create `apps/cli/src/watch.ts` - Watch mode logic
- Update `apps/cli/src/cli.ts` - Add --watch flag

### Task 4: Shell Completions [30min-1h]

**Problem:** Users must remember all flags
**Solution:** Shell completions for bash/zsh

```bash
# Install completions
code-audit completions > /usr/local/share/bash-completion/completions/code-audit

# Usage (after installation)
code-audit --<TAB>  # Shows all flags
code-audit --format <TAB>  # Shows: text, json, markdown, html
```

**Implementation:**
- Create `apps/cli/src/completions.ts` - Generate completion script
- Add `completions` subcommand
- Support bash and zsh

### Task 5: Verbosity Levels [30min]

**Problem:** Too much or too little output
**Solution:** Verbosity flags

```bash
code-audit --quiet src/        # Only overall score + critical findings
code-audit src/                # Normal (default)
code-audit --verbose src/      # All findings + debug info
code-audit --debug src/        # + API calls, timing, token usage
```

**Implementation:**
- Add verbosity level to config
- Filter output based on level
- Add timing info in verbose mode

### Task 6: Better Progress UI [1h]

**Problem:** Current progress is basic (PLAN-8 added spinners)
**Enhancement:** Richer progress visualization

```bash
code-audit src/

Discovering files... ✓ Found 47 files (234 KB)
Creating chunks... ✓ 1 chunk (within 100K token limit)

Running 7 agents in parallel...

 ■■■■■■■■□□ 80% Complete (6/7 agents)

  ✓ correctness      [2.3s] ████████████████ 8.5/10
  ✓ security         [2.1s] ███████████████  7.2/10
  ✓ performance      [1.9s] ██████████████   9.0/10
  ✓ maintainability  [2.0s] ███████████████  7.8/10
  ✓ edge-cases       [1.8s] ████████████████ 8.1/10
  ✓ accessibility    [2.2s] ██████████████   8.8/10
  ⏳ documentation   ...

Overall Score: 8.2/10 (weighted)
Total Time: 3.8s

3 critical, 12 warnings, 8 info findings
View detailed report with --verbose
```

**Implementation:**
- Use `cli-progress` package for progress bar
- Show visual score bars
- Real-time updates as agents complete

## Success Criteria

**What (goal states):**
- [ ] Config file support (.code-audit.json)
- [ ] JSON output format
- [ ] Markdown output format
- [ ] HTML output format
- [ ] Watch mode (--watch flag)
- [ ] Shell completions (bash/zsh)
- [ ] Verbosity levels (--quiet, --verbose, --debug)
- [ ] Enhanced progress UI with bars

**How to verify:**
```bash
# Config file
echo '{"exclude": ["test"]}' > .code-audit.json
code-audit .
# Should exclude test directory

# Output formats
code-audit --format json . > out.json
code-audit --format markdown . > out.md
code-audit --format html . > out.html
# Check file contents

# Watch mode
code-audit --watch src/
# Edit a file, should re-run

# Completions
code-audit completions
# Should output completion script

# Verbosity
code-audit --quiet .     # Minimal output
code-audit --verbose .   # Detailed output
```

## Mandatory Workflow

After completing work:

1. **Verify** - Test all new features manually
2. **Document** - Update README with new flags and config options
3. **Report** - Commit: `feat(cli): add config file, output formats, and watch mode`
4. **Context** - Report usage

## Expected Impact

**Before:**
- Basic CLI (audit command only)
- Text output only
- Manual re-runs
- Flag-based configuration

**After:**
- Rich configuration (.code-audit.json)
- 4 output formats (text, JSON, markdown, HTML)
- Watch mode for continuous analysis
- Shell completions
- Verbosity control
- Better progress visualization

**ROI:** Medium - Improves UX but doesn't affect core analysis quality
