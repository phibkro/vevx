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
- Manifest type unification — uses `@varp/core/lib` types (`Manifest`, `Component`, `componentPaths`) instead of local duplicates
- Token budgeting — `--budget <tokens>` flag, skips low-priority tasks when estimated token budget exceeded
- Drift tracking — `diffReports()` diffs current vs baseline `ComplianceReport` (new/resolved/changed findings, trend)

## Next

### Varp Core Integration (remaining)

- Wave scheduling → varp scheduler: **not applicable** — audit tasks are read-only, so `detectHazards()` returns zero hazards and `computeWaves()` puts everything in wave 0. The 3-wave structure (component → cross-cutting → synthesis) is a domain ordering, not a data-dependency ordering. Revisit if audit gains auto-fix (write) capabilities.

## Future

- Anthropic SDK caller — alternative to Claude CLI for API key auth
- Custom organizational rulesets (beyond OWASP)
- CLI `--baseline` flag — wire drift tracking into `varp audit` (library-side done, needs CLI integration)
