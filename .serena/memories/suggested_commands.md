# Suggested Commands

## Development
| Command | Purpose |
|---------|---------|
| `bun test` | Run all tests |
| `bun test src/manifest/imports.test.ts` | Run specific test file |
| `bun run check` | CI gate: format check + lint + shellcheck + build |
| `bun run build` | Bundle to build/ via bun build |
| `bun run typecheck` | Type-check via tsc --noEmit (not in CI gate) |
| `bun run lint` | Run oxlint |
| `bun run format` | Auto-format with oxfmt |

## System Utils (macOS/Darwin)
| Command | Purpose |
|---------|---------|
| `git` | Version control |
| `shellcheck` | Shell script linting (used in CI gate) |
| `bun` | Runtime, package manager, test runner, bundler |
