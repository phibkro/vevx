# Suggested Commands

## Monorepo (from root)

| Command       | Purpose            |
| ------------- | ------------------ |
| `turbo build` | Build all packages |
| `turbo test`  | Run all tests      |

## @varp/core (from packages/core/)

| Command             | Purpose                                     |
| ------------------- | ------------------------------------------- |
| `bun test`          | Run core tests (296 tests)                  |
| `bun run check`     | CI gate: format + lint + shellcheck + build |
| `bun run build`     | Bundle to build/ via bun build              |
| `bun run typecheck` | Type-check via tsc --noEmit                 |
| `bun run lint`      | Run oxlint                                  |
| `bun run format`    | Auto-format with oxfmt                      |

## @varp/audit (from packages/audit/)

| Command          | Purpose                     |
| ---------------- | --------------------------- |
| `npx vitest run` | Run audit tests (187 tests) |
| `tsc`            | Build to dist/              |

## System Utils (macOS/Darwin)

| Command      | Purpose                                        |
| ------------ | ---------------------------------------------- |
| `git`        | Version control                                |
| `shellcheck` | Shell script linting (used in CI gate)         |
| `bun`        | Runtime, package manager, test runner, bundler |
