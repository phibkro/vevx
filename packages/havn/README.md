# @vevx/havn

Default Claude Code plugin setup. A stable harbor for AI agents setting sail on new projects.

## What it provides

- **Builder agent** -- domain-agnostic implementation agent with project-level memory
- **Reviewer agent** -- structured review agent with PASS/FAIL verdicts and project memory
- **Git hook management** -- SessionStart hook auto-installs a pre-commit hook (format, lint, build, test, changeset verification)
- **Plugin auto-detection** -- SessionEnd hook enables Claude Code plugins based on project dependencies (Effect TS, React/Next.js, plugin-dev)

Standalone -- no dependencies on other vevx packages.

## Configuration

Create `.havn.json` in your project root to override pre-commit hook defaults:

```json
{
  "precommit": {
    "format": "turbo format",
    "quality": "turbo lint && turbo build",
    "test": "turbo test",
    "main": "main"
  }
}
```

All fields are optional. Without overrides, the hook auto-detects your runner (turbo > bun > npm) and available package.json scripts. Format and quality checks run on all branches; tests and changeset verification run only on the main branch.

## Plugin assets

| Path | Type | Purpose |
|------|------|---------|
| `agents/builder.md` | Agent | Implementation agent with project memory |
| `agents/reviewer.md` | Agent | Review agent with structured PASS/FAIL output |
| `hooks/install-hooks.sh` | SessionStart hook | Installs pre-commit hook, sets `core.hooksPath` |
| `hooks/sync-plugins.sh` | SessionEnd hook | Detects deps, enables matching plugins in `settings.local.json` |
| `hooks/pre-commit.sh` | Git hook | Format + lint + build (all branches), test + changeset (main only) |
| `templates/agent.md` | Template | Agent frontmatter reference |
| `templates/SKILL.md` | Template | Skill frontmatter reference |
