# Analysis Configuration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add analysis configuration via `.varp/config.json` with Zod schema validation, sparse overrides, conventional commit type multipliers, and document it in the design doc.

**Architecture:** A `AnalysisConfigSchema` Zod schema defines all tunable analysis parameters with `.default()` values. `loadAnalysisConfig(repoDir)` reads `.varp/config.json` if present, otherwise returns defaults. The config flows through existing analysis functions by replacing hardcoded constants with config lookups. The design doc gets a new "Analysis Configuration" section.

**Tech Stack:** Zod (schema + defaults), Bun (file I/O), bun:test

---

### Task 1: Define AnalysisConfigSchema

**Files:**
- Create: `packages/core/src/analysis/config.ts`
- Test: `packages/core/src/analysis/config.test.ts`

**Context:** All analysis tuning knobs currently live as hardcoded defaults in `FilterConfigSchema` (shared/types.ts:245-253), `computeComplexityTrends` (hotspots.ts:228, default 500), and the weighting formula in `computeCoChangeEdges` (co-change.ts:112). The config schema centralizes these with the same defaults so behavior is unchanged without a config file.

**Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "bun:test";
import { AnalysisConfigSchema, loadAnalysisConfig } from "./config.js";

describe("AnalysisConfigSchema", () => {
  it("provides full defaults when parsing empty object", () => {
    const config = AnalysisConfigSchema.parse({});
    expect(config.cochange.commit_size_ceiling).toBe(50);
    expect(config.cochange.message_excludes).toContain("merge");
    expect(config.cochange.file_excludes).toContain("**/bun.lock");
    expect(config.cochange.type_multipliers).toBeUndefined();
    expect(config.hotspots.max_commits).toBe(500);
    expect(config.hotspots.trend_threshold).toBe(1);
  });

  it("allows sparse overrides", () => {
    const config = AnalysisConfigSchema.parse({
      cochange: { commit_size_ceiling: 30 },
    });
    expect(config.cochange.commit_size_ceiling).toBe(30);
    // Other defaults preserved
    expect(config.cochange.message_excludes).toContain("merge");
    expect(config.hotspots.max_commits).toBe(500);
  });

  it("accepts conventional commit type multipliers", () => {
    const config = AnalysisConfigSchema.parse({
      cochange: {
        type_multipliers: { feat: 1.0, fix: 1.0, chore: 0.2 },
      },
    });
    expect(config.cochange.type_multipliers).toEqual({
      feat: 1.0,
      fix: 1.0,
      chore: 0.2,
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/analysis/config.test.ts`
Expected: FAIL — cannot resolve `./config.js`

**Step 3: Write minimal implementation**

```typescript
import { z } from "zod";

export const CoChangeConfigSchema = z.object({
  commit_size_ceiling: z.number().int().positive().default(50),
  message_excludes: z
    .array(z.string())
    .default(["chore", "style", "format", "lint", "merge", "rebase"]),
  file_excludes: z
    .array(z.string())
    .default([
      "**/package-lock.json",
      "**/bun.lock",
      "**/bun.lockb",
      "**/*.d.ts",
      "**/.varp/**",
    ]),
  type_multipliers: z.record(z.string(), z.number().min(0).max(2)).optional(),
});

export const HotspotsConfigSchema = z.object({
  max_commits: z.number().int().positive().default(500),
  trend_threshold: z.number().nonnegative().default(1),
});

export const AnalysisConfigSchema = z.object({
  cochange: CoChangeConfigSchema.default({}),
  hotspots: HotspotsConfigSchema.default({}),
});

export type AnalysisConfig = z.infer<typeof AnalysisConfigSchema>;
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/analysis/config.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add packages/core/src/analysis/config.ts packages/core/src/analysis/config.test.ts
git commit -m "feat(analysis): add AnalysisConfigSchema with sparse defaults"
```

---

### Task 2: Add loadAnalysisConfig and toFilterConfig bridge

**Files:**
- Modify: `packages/core/src/analysis/config.ts`
- Modify: `packages/core/src/analysis/config.test.ts`

**Context:** `loadAnalysisConfig(repoDir)` reads `.varp/config.json` if it exists, returns parsed config with defaults filled in. If the file is missing, returns full defaults. A `toFilterConfig()` bridge converts the analysis config's cochange section into the existing `FilterConfig` shape so existing functions don't need signature changes yet.

**Step 1: Add test for loadAnalysisConfig**

Append to the existing test file:

```typescript
import { loadAnalysisConfig, toFilterConfig } from "./config.js";

// ... inside a new describe block:
describe("loadAnalysisConfig", () => {
  it("returns defaults when no config file exists", () => {
    const config = loadAnalysisConfig("/nonexistent/path");
    expect(config.cochange.commit_size_ceiling).toBe(50);
    expect(config.hotspots.max_commits).toBe(500);
  });

  it("loads and merges config from .varp/config.json", async () => {
    const tmpDir = await import("fs").then((fs) => {
      const dir = `${process.env.TMPDIR ?? "/tmp/claude"}/varp-config-test-${Date.now()}`;
      fs.mkdirSync(`${dir}/.varp`, { recursive: true });
      fs.writeFileSync(
        `${dir}/.varp/config.json`,
        JSON.stringify({ cochange: { commit_size_ceiling: 25 } }),
      );
      return dir;
    });

    const config = loadAnalysisConfig(tmpDir);
    expect(config.cochange.commit_size_ceiling).toBe(25);
    expect(config.cochange.message_excludes).toContain("merge"); // defaults preserved
  });
});

describe("toFilterConfig", () => {
  it("maps analysis config to FilterConfig shape", () => {
    const config = AnalysisConfigSchema.parse({
      cochange: { commit_size_ceiling: 30 },
    });
    const filter = toFilterConfig(config);
    expect(filter.max_commit_files).toBe(30);
    expect(filter.skip_message_patterns).toContain("merge");
    expect(filter.exclude_paths).toContain("**/bun.lock");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/analysis/config.test.ts`
Expected: FAIL — `loadAnalysisConfig` and `toFilterConfig` not exported

**Step 3: Implement**

Add to `config.ts`:

```typescript
import { join } from "path";
import { existsSync, readFileSync } from "fs";
import type { FilterConfig } from "#shared/types.js";

const CONFIG_PATH = ".varp/config.json";

/**
 * Load analysis config from `.varp/config.json` in the given directory.
 * Returns full defaults if the file doesn't exist.
 */
export function loadAnalysisConfig(repoDir: string): AnalysisConfig {
  const configPath = join(repoDir, CONFIG_PATH);
  if (!existsSync(configPath)) {
    return AnalysisConfigSchema.parse({});
  }
  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return AnalysisConfigSchema.parse(raw);
}

/**
 * Bridge: convert AnalysisConfig's cochange section to the existing FilterConfig shape.
 * This lets existing functions accept FilterConfig without signature changes.
 */
export function toFilterConfig(config: AnalysisConfig): FilterConfig {
  return {
    max_commit_files: config.cochange.commit_size_ceiling,
    skip_message_patterns: config.cochange.message_excludes,
    exclude_paths: config.cochange.file_excludes,
  };
}
```

Note: Use `fs` from Node compat (available in Bun) rather than `Bun.file()` since this is synchronous config loading. Check if the codebase uses Bun-specific file APIs or Node APIs — match the existing pattern.

**Step 4: Run test to verify it passes**

Run: `bun test packages/core/src/analysis/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/core/src/analysis/config.ts packages/core/src/analysis/config.test.ts
git commit -m "feat(analysis): add loadAnalysisConfig and toFilterConfig bridge"
```

---

### Task 3: Wire config into scanCoChangesWithCache

**Files:**
- Modify: `packages/core/src/analysis/cache.ts`
- Modify: `packages/core/src/analysis/cache.test.ts` (if tests reference hardcoded defaults)

**Context:** `scanCoChangesWithCache()` currently accepts an optional `Partial<FilterConfig>`. Wire it to load analysis config from the repo dir and use `toFilterConfig()` as the default when no explicit config is passed. This makes `.varp/config.json` automatically apply to cached scans.

**Step 1: Read `cache.ts` to understand the current `scanCoChangesWithCache` signature**

The function should be updated so that when `config` is omitted, it loads from `.varp/config.json` instead of relying solely on `FilterConfigSchema` defaults. The change is small:

```typescript
// Before (inside scanCoChangesWithCache):
const fullConfig = FilterConfigSchema.parse(config ?? {});

// After:
const analysisConfig = loadAnalysisConfig(repoDir);
const fullConfig = FilterConfigSchema.parse(config ?? toFilterConfig(analysisConfig));
```

**Step 2: Write or update test**

Add a test that verifies `.varp/config.json` affects `scanCoChangesWithCache`. Use a temp dir with both a git repo and a config file. This may be complex — if the existing test infrastructure already covers this flow, a simpler approach is to verify the `loadAnalysisConfig` + `toFilterConfig` bridge (already tested in Task 2) and trust the composition.

**Step 3: Run tests**

Run: `bun test packages/core/src/analysis/`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/core/src/analysis/cache.ts
git commit -m "feat(analysis): wire .varp/config.json into cached co-change scanning"
```

---

### Task 4: Add conventional commit type multiplier support

**Files:**
- Modify: `packages/core/src/analysis/co-change.ts`
- Modify: `packages/core/src/analysis/co-change.test.ts`

**Context:** When `type_multipliers` is present in config, the weighting formula becomes `type_multiplier * (1 / (n - 1))`. The commit type is extracted from the subject line using the conventional commit pattern `type(scope): message` or `type: message`. If the commit doesn't match the pattern or the type isn't in the multipliers map, the base formula (`1.0 * 1/(n-1)`) is used unchanged.

**Step 1: Write the failing test**

```typescript
it("applies type multipliers to edge weights", () => {
  const commits = [
    { sha: "a", subject: "feat: add login", files: ["a.ts", "b.ts"] },
    { sha: "b", subject: "chore: update deps", files: ["a.ts", "c.ts"] },
  ];
  const multipliers = { feat: 1.0, chore: 0.2 };
  const edges = computeCoChangeEdges(commits, multipliers);

  const ab = edges.find((e) => e.files.includes("a.ts") && e.files.includes("b.ts"));
  const ac = edges.find((e) => e.files.includes("a.ts") && e.files.includes("c.ts"));

  expect(ab?.weight).toBe(1.0); // feat: 1.0 * 1/(2-1) = 1.0
  expect(ac?.weight).toBe(0.2); // chore: 0.2 * 1/(2-1) = 0.2
});

it("uses base weight when no type match", () => {
  const commits = [
    { sha: "a", subject: "random message", files: ["a.ts", "b.ts"] },
  ];
  const multipliers = { feat: 1.0 };
  const edges = computeCoChangeEdges(commits, multipliers);

  expect(edges[0].weight).toBe(1.0); // no match → 1.0 * 1/(2-1)
});
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/core/src/analysis/co-change.test.ts`
Expected: FAIL — `computeCoChangeEdges` doesn't accept a second argument

**Step 3: Implement**

Update `computeCoChangeEdges` to accept an optional `typeMultipliers` parameter:

```typescript
const CONVENTIONAL_COMMIT_RE = /^(\w+)(?:\(.+?\))?!?:\s/;

export function computeCoChangeEdges(
  commits: Commit[],
  typeMultipliers?: Record<string, number>,
): CoChangeEdge[] {
  // ... existing code, but change the weight calculation:
  const baseWeight = 1 / (files.length - 1);
  let multiplier = 1.0;
  if (typeMultipliers) {
    const match = commit.subject.match(CONVENTIONAL_COMMIT_RE);
    if (match && match[1] in typeMultipliers) {
      multiplier = typeMultipliers[match[1]];
    }
  }
  const w = multiplier * baseWeight;
  // ... rest unchanged
}
```

Also update `analyzeCoChanges` to pass through the multipliers.

**Step 4: Run tests**

Run: `bun test packages/core/src/analysis/co-change.test.ts`
Expected: PASS (existing tests unchanged since multiplier is optional)

**Step 5: Commit**

```bash
git add packages/core/src/analysis/co-change.ts packages/core/src/analysis/co-change.test.ts
git commit -m "feat(analysis): support conventional commit type multipliers in co-change weighting"
```

---

### Task 5: Wire hotspot config

**Files:**
- Modify: `packages/core/src/analysis/hotspots.ts`

**Context:** `computeComplexityTrends` has `maxCommits` defaulting to 500 and `computeComplexityTrendsFromStats` has a hardcoded trend threshold of 1. These should accept the values from analysis config. Since these are already optional parameters, this is just changing where defaults come from — callers that pass explicit values are unaffected.

**Step 1: Update `computeComplexityTrendsFromStats` to accept a threshold option**

Currently (line ~204): `if (magnitude < 1)` → change to `if (magnitude < (options?.trendThreshold ?? 1))`

This is a minimal change. The existing default of 1 is preserved.

**Step 2: Run tests**

Run: `bun test packages/core/src/analysis/hotspots.test.ts`
Expected: PASS (no behavioral change with default)

**Step 3: Commit**

```bash
git add packages/core/src/analysis/hotspots.ts
git commit -m "feat(analysis): make hotspot trend threshold configurable"
```

---

### Task 6: Export from lib.ts and update lib.d.ts

**Files:**
- Modify: `packages/core/src/lib.ts`
- Modify: `packages/core/lib.d.ts`

**Context:** Export `AnalysisConfigSchema`, `AnalysisConfig`, `loadAnalysisConfig`, and `toFilterConfig` from the library entry point so audit and CLI can consume them.

**Step 1: Add exports to lib.ts**

```typescript
// In the Analysis section:
export { AnalysisConfigSchema, loadAnalysisConfig, toFilterConfig } from "./analysis/config.js";
export type { AnalysisConfig } from "./analysis/config.js";
```

**Step 2: Add declarations to lib.d.ts**

```typescript
// After AnalysisConfig section:
export type AnalysisConfig = {
  cochange: {
    commit_size_ceiling: number;
    message_excludes: string[];
    file_excludes: string[];
    type_multipliers?: Record<string, number>;
  };
  hotspots: {
    max_commits: number;
    trend_threshold: number;
  };
};

export declare const AnalysisConfigSchema: ZodType<AnalysisConfig>;
export function loadAnalysisConfig(repoDir: string): AnalysisConfig;
export function toFilterConfig(config: AnalysisConfig): FilterConfig;
```

**Step 3: Build and verify**

Run: `bunx turbo build`
Expected: All packages build successfully

**Step 4: Commit**

```bash
git add packages/core/src/lib.ts packages/core/lib.d.ts
git commit -m "feat(analysis): export config types and functions from @varp/core/lib"
```

---

### Task 7: Add "Analysis Configuration" section to design doc

**Files:**
- Modify: `docs/designs/002-relational-architecture-analysis.md`

**Context:** Add the new section after "Incremental Analysis and Caching" (after line 232). Also resolve the open question about default commit size ceiling (answer: 50) and default noise filter patterns (answer: the current defaults).

**Step 1: Add the section**

Insert after the `---` on line 233:

```markdown
## Analysis Configuration

Analysis tuning lives in `.varp/config.json`, not in the manifest. The manifest (`varp.yaml`) describes *what the project looks like* — components, paths, dependencies, tags. Analysis config describes *how varp analyzes the project* — weighting formulas, thresholds, noise filters. Different audiences, different change cadences. A developer reading the manifest to understand component topology shouldn't encounter engine tuning knobs.

### Sparse Defaults

If `.varp/config.json` doesn't exist, all parameters use hardcoded defaults. If it exists, only specified fields override defaults. No generated config files full of default values — defaults live in code (`AnalysisConfigSchema` in `analysis/config.ts`), surfaced as Zod `.default()` calls.

**Design principle:** Every number in the analysis pipeline is a named constant with a default, exposed in config. Not because users will tune them — most won't — but because it forces every assumption to be explicit. Defaults must produce good diagnostics on most codebases without any configuration. Configuration is for the edges, not the center.

### Schema

```json
{
  "cochange": {
    "commit_size_ceiling": 50,
    "type_multipliers": {
      "feat": 1.0,
      "fix": 1.0,
      "refactor": 0.7,
      "test": 0.5,
      "docs": 0.3,
      "chore": 0.2,
      "style": 0.1,
      "ci": 0.1
    },
    "message_excludes": ["chore", "style", "format", "lint", "merge", "rebase"],
    "file_excludes": ["**/package-lock.json", "**/bun.lock", "**/bun.lockb", "**/*.d.ts", "**/.varp/**"]
  },
  "hotspots": {
    "max_commits": 500,
    "trend_threshold": 1
  }
}
```

All fields are optional. Omitted fields use the defaults shown.

### Conventional Commit Integration

When `type_multipliers` is configured, commit type prefixes become a signal dimension. Each commit type gets a multiplier applied to the base graduated weighting:

```
edge_weight = type_multiplier × (1 / (n - 1))
```

The type is extracted from the conventional commit pattern (`type(scope): message`). Commits that don't match the pattern use a multiplier of `1.0` — no penalty, no boost.

This is opt-in enhanced signal, not a requirement. Projects without conventional commits or without `type_multipliers` configured use the base formula unchanged.

### Relationship to FilterConfig

The existing `FilterConfig` type (used by `scanCoChanges`, `analyzeCoChanges`) maps directly to a subset of the analysis config. A `toFilterConfig()` bridge converts between them, so existing function signatures are unchanged. New code should prefer `AnalysisConfig`; `FilterConfig` remains for backward compatibility.
```

**Step 2: Update Open Questions**

Change the open questions about defaults to resolved:

```markdown
- ~~What's the right default commit size ceiling?~~ Resolved: 50 files. See Analysis Configuration section.
- ~~What commit message patterns should the default noise filter include?~~ Resolved: `["chore", "style", "format", "lint", "merge", "rebase"]`. See Analysis Configuration section.
```

**Step 3: Commit**

```bash
git add docs/designs/002-relational-architecture-analysis.md
git commit -m "docs: add Analysis Configuration section to relational analysis design doc"
```

---

### Task 8: Final verification

**Step 1: Run all tests**

Run: `bunx turbo test`
Expected: All tests pass across all packages

**Step 2: Run check**

Run: `bunx turbo check`
Expected: All packages pass (format + lint + build)

**Step 3: Verify no regressions**

Run: `bun run packages/cli/dist/cli.js lint`
Expected: No new errors (warnings acceptable)
