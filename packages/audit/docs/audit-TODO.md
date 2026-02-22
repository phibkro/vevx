# Audit Package — Remaining Work

## Done

- Ruleset parser (markdown → typed rules)
- Plan generator (files + rules → 3-wave task list)
- Findings schema (types, deduplication, corroboration, coverage)
- Prompt generator (tasks → Claude prompts, response parsing)
- Executor (plan → Claude Code CLI calls → ComplianceReport)
- Compliance reporter (terminal, markdown, JSON output)
- CLI wiring (`varp audit <path> --ruleset <name>`)
- Self-audit dogfooding (see `docs/examples/self-audit-report.md`)
- Security hardening (env var filtering, error sanitization, relative path logging)
- Manifest adapter — `generatePlan()` uses varp.yaml components and tag-based rule matching when available, falls back to heuristic grouping
- False positive suppression — inline `// audit-suppress RULE-ID` comments and `.audit-suppress.yaml` config files
- Incremental audits — `--diff [ref]` flag filters to changed files, with manifest-aware invalidation cascade

## Next

### CI Integration

GitHub Action or similar. Exit code 1 on critical findings is already CI-friendly. Needs: action YAML, markdown report as PR comment or artifact, configurable severity threshold for exit code.

### Full Varp Scheduler Integration

The manifest adapter replaces heuristic component grouping and tag matching, but wave scheduling is still hardcoded 3-wave. Varp's `computeWaves()` requires tasks with `touches: { reads?, writes? }` — audit tasks are read-only, so the current 3-wave structure is correct. Full scheduler integration adds value only if audit gains write-capable tasks.

### Remaining Varp Integration

- File discovery via manifest paths + `discoverDocs()` (currently uses standalone discovery)
- Component doc loading as additional audit context via `resolveDocs()`
- Import-based rule matching via `scanImports()` for more precise file→rule mapping
