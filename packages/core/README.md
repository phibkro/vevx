# @varp/core

Shared library for varp. Provides manifest parsing, scheduling, plan validation, capability enforcement, coupling analysis, and doc freshness tracking. Consumed by `@varp/mcp` (MCP server), `@varp/audit`, and `@varp/cli`.

## Library Entry Point

Single entry point for external consumers. Uses a hand-maintained `lib.d.ts` to avoid leaking Zod internals.

### `@varp/core/lib`

All types and functions (pure + Bun-dependent).

```ts
import { componentPaths, findOwningComponent, invalidationCascade } from "@varp/core/lib";
import { parseManifest, runLint, checkFreshness, renderGraph } from "@varp/core/lib";
import { parsePlanFile, validatePlan, detectHazards, scanImports } from "@varp/core/lib";
import type { Manifest, Component, Stability, LintReport, FreshnessReport } from "@varp/core/lib";
```

Update `lib.d.ts` when exported signatures change.

## Modules

| Module | Path | Purpose |
|--------|------|---------|
| shared | `src/shared/` | Types (`Manifest`, `Component`, `Touches`), ownership resolution, config |
| manifest | `src/manifest/` | Parser, doc resolver, freshness, graph, imports, links, lint, scoped tests |
| plan | `src/plan/` | Plan XML parsing, validation, diffing, log parsing |
| scheduler | `src/scheduler/` | Hazard detection, wave computation, critical path |
| enforcement | `src/enforcement/` | Capability verification, restart strategy |
| analysis | `src/analysis/` | Co-change scanning, coupling matrix, hotspots, codebase graph |
| execution | `src/execution/` | Chunking, concurrency, token estimation |

## Types

```typescript
interface Manifest {
  varp: string
  components: Record<string, Component>
}

type Stability = 'stable' | 'active' | 'experimental'

interface Component {
  path: string | string[]
  deps?: string[]
  docs: string[]
  tags?: string[]
  test?: string
  env?: string[]
  stability?: Stability
}

interface Touches {
  reads?: string[]
  writes?: string[]
}

interface TaskDefinition {
  id: string
  touches: Touches
  mutexes?: string[]
}
```

Full type definitions are in `lib.d.ts`.
