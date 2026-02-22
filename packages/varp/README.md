# @vevx/varp

Consolidated varp package: MCP server, CLI, skills, hooks, and shared library.

## Entry Points

| Entry | Build output | Purpose |
|---|---|---|
| `src/lib.ts` | `build/lib.js` | Library for external consumers (`@vevx/varp/lib`) |
| `src/mcp/index.ts` | `build/index.js` | MCP server (stdio transport) |
| `src/cli/cli.ts` | `dist/cli.js` | CLI binary (`varp`) |

## Library (`@vevx/varp/lib`)

All types and functions (pure + Bun-dependent). Used by `@vevx/audit`. Hand-maintained `lib.d.ts` — update when exported signatures change.

```ts
import { parseManifest, runLint, checkFreshness, renderGraph } from "@vevx/varp/lib";
import { parsePlanFile, validatePlan, detectHazards, scanImports } from "@vevx/varp/lib";
import type { Manifest, Component, Stability, LintReport } from "@vevx/varp/lib";
```

## Modules

| Module | Path | Purpose |
|---|---|---|
| shared | `src/shared/` | Types (`Manifest`, `Component`, `Touches`), ownership resolution, config |
| manifest | `src/manifest/` | Parser, doc resolver, freshness, graph, imports, links, lint, scoped tests |
| plan | `src/plan/` | Plan XML parsing, validation, diffing, log parsing |
| scheduler | `src/scheduler/` | Hazard detection, wave computation, critical path |
| enforcement | `src/enforcement/` | Capability verification, restart strategy |
| analysis | `src/analysis/` | Co-change scanning, coupling matrix, hotspots, codebase graph |
| execution | `src/execution/` | Chunking, concurrency, token estimation |
| mcp | `src/mcp/` | MCP server, tool definitions, tool registry |
| cli | `src/cli/` | CLI subcommands: init, graph, lint, freshness, validate, coupling, summary |

## Plugin Assets

| Asset | Path | Purpose |
|---|---|---|
| Skills | `skills/` | 6 SKILL.md files (init, status, plan, execute, review, coupling) |
| Hooks | `hooks/` | 4 lifecycle hooks (session-start, subagent-context, freshness-track, stop) |
| Plugin manifest | `.claude-plugin/` | plugin.json, marketplace.json |

## Types

```typescript
interface Manifest {
  varp: string;
  components: Record<string, Component>;
}

type Stability = "stable" | "active" | "experimental";

interface Component {
  path: string | string[];
  deps?: string[];
  docs: string[];
  tags?: string[];
  test?: string;
  env?: string[];
  stability?: Stability;
}
```

Full type definitions are in `lib.d.ts`.
