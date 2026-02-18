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

## Next

### CI Integration

GitHub Action or similar. Exit code 1 on critical findings is already CI-friendly. Needs: action YAML, markdown report as PR comment or artifact, configurable severity threshold for exit code.

### Varp Core Integration (post-merge)

Replace stopgap implementations with varp core primitives:
- `groupIntoComponents()` → varp manifest's component definitions
- Wave scheduling → varp scheduler (critical path, hazard detection)
- File discovery → manifest paths + `discoverDocs()`

See `docs/audit/research/varp-integration.md` for full mapping.
