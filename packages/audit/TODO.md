# Audit Package — TODO

## Done

- Ruleset parser (markdown → typed rules)
- Plan generator (files + rules → 3-wave audit plan, manifest-aware)
- Manifest adapter (varp.yaml → audit components, tag-based rule matching)
- Findings schema (types, deduplication, corroboration, coverage)
- Prompt generator (tasks → Claude prompts, JSON schema, response parser)
- Executor (plan → API calls → ComplianceReport)
- Compliance reporter (terminal, markdown, JSON output)
- Suppressions (`// audit-suppress RULE-ID` inline + `.audit-suppress.yaml` config)
- Diff filtering (`--diff [ref]`, changed files + manifest-aware invalidation cascade)

## Next

### Decouple from Claude CLI (`ModelCaller` extraction)

`packages/audit` currently hardcodes `client.ts` (spawns `claude -p` subprocesses). This blocks API key auth, GitHub Actions (no `claude` CLI in CI), and alternative backends.

**Done in code-review repo** — needs porting:
- `ModelCaller` type in `planner/types.ts` — `(systemPrompt, userPrompt, options) => Promise<string>`
- `ExecutorOptions.caller: ModelCaller` and `OrchestratorOptions.caller: ModelCaller` (required)
- Remove `callClaude` import from `executor.ts` and `orchestrator.ts`
- Remove `export * from './client'` from `index.ts`
- Move `client.ts` to `apps/cli/src/claude-client.ts`
- CLI passes `caller: callClaude` when calling `executeAuditPlan()` / `runAudit()`

**Reference**: `code-review` repo commit `f203a69`

### CLI Wiring

Wire `varp audit --ruleset <name> <path>` into the CLI. `apps/cli/src/` is currently empty.

**Flow**: parse args → discover files → load ruleset → generate plan → execute plan → render report

**Flags needed**:
- `--ruleset` — name (looks in `rulesets/`) or path to custom file
- `--model` — override default model
- `--concurrency` — max parallel API calls
- `--format` — terminal (default), markdown, json
- `--diff [ref]` — incremental audit (changed files only)
- `--suppress` — path to suppression config
- Progress reporting via executor's `onProgress` callback

### Varp Core Integration

Replace stopgap implementations with varp core primitives:
- `groupIntoComponents()` → varp manifest component definitions
- Wave scheduling → varp scheduler (critical path, hazard detection)
- Token budgeting → budget-aware task selection

## Future

- `--budget` flag — max tokens to spend, skip low-priority tasks when exhausted
- Anthropic SDK caller — alternative to Claude CLI for API key auth
- Custom organizational rulesets (beyond OWASP)
- Audit-over-time — diff findings against previous runs for compliance drift tracking
