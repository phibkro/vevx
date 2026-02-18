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
- `ModelCaller` extraction — library is backend-agnostic, CLI provides Claude CLI caller
- CLI wiring — `varp audit --ruleset <name> <path>` with all flags (model, concurrency, format, diff, suppress, progress)

## Next

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
