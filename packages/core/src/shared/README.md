# Shared

Shared types, utilities, and test helpers used across all core domain components.

## Key Exports

| Export | File | Purpose |
|--------|------|---------|
| Zod schemas + inferred types | `types.ts` | All domain types: manifest, plan, scheduler, enforcement, warm staleness |
| `buildComponentPaths()` | `ownership.ts` | Builds sorted component path map from manifest |
| `findOwningComponent()` | `ownership.ts` | Longest-prefix match to find which component owns a file |
| `makeTask()` | `test-helpers.ts` | Factory for test tasks with touches and optional mutexes |
| `makePlan()` | `test-helpers.ts` | Factory for test plans |

## Type Convention

All types are Zod-schema-first. The schema is the source of truth; TypeScript types are inferred via `z.infer<>`.

```ts
import { ManifestSchema, type Manifest } from "#shared/types.js";
```

## Import Alias

Other core components import via `#shared/*` (configured in `tsconfig.json` paths):

```ts
import { type Manifest } from "#shared/types.js";
import { findOwningComponent } from "#shared/ownership.js";
```
