# CLI Source

Deterministic manifest tooling. Each subcommand wraps a `@varp/core/lib` function with argument parsing and output formatting.

## Subcommands

| File | Command | Core function |
|------|---------|---------------|
| `init.ts` | `varp init` | `suggestComponents()` |
| `graph.ts` | `varp graph` | `renderAsciiGraph()` / `renderGraph()` / `renderTagGroups()` |
| `lint.ts` | `varp lint` | `lint()` |
| `freshness.ts` | `varp freshness` | `checkFreshness()` |
| `validate.ts` | `varp validate` | `validatePlan()` |
| `coupling.ts` | `varp coupling` | `couplingMatrix()` / `couplingHotspots()` |
| `conventions.ts` | `varp conventions` | `DEFAULT_DETECTION_CONFIG` |

## Shared

| File | Purpose |
|------|---------|
| `args.ts` | `DEFAULT_MANIFEST`, `parseEnum()`, `consumeOptionalFlag()` |
| `errors.ts` | `formatError()` — user-friendly error output |
| `completions.ts` | Bash/zsh completion scripts |
