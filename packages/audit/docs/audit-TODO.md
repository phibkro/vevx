# Audit Package — Remaining Work

Last updated: February 2026. See [implementation-status.md](implementation-status.md) for what's built.

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
- Drift tracking — `--baseline` compares reports, renders finding-level diffs

## Remaining

### Additional Rulesets

OWASP Top 10 is the only shipped ruleset. Additional frameworks:
- HIPAA (healthcare data handling)
- PCI-DSS (payment card data)
- GDPR (data privacy, consent, deletion)
- Custom organizational rulesets (framework supports it; needs examples and docs)

### Deeper Varp Integration

- File discovery via manifest paths + `discoverDocs()` (currently uses standalone discovery)
- Component doc loading as additional audit context via `resolveDocs()`
- Import-based rule matching via `scanImports()` for more precise file → rule mapping

### CI Integration

GitHub Action or similar. Exit code 1 on critical findings is already CI-friendly. Needs:
- Action YAML
- Markdown report as PR comment or artifact
- Configurable severity threshold for exit code

### Not Planned

- **Core strategy layer** — audit executes directly; no routing through a shared strategy service
- **`--quick` / `--thorough` flags** — single execution mode is sufficient
- **Redundant agent passes** — corroboration happens naturally when independent tasks flag the same issue
- **Full varp scheduler integration** — audit tasks are read-only; the 3-wave hardcoded structure is correct
