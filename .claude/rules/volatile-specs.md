# Volatile Specifications

Certain APIs and specs change frequently. Before modifying code that depends on them, **search the web for the current spec** rather than relying on cached knowledge.

## Mandatory Web Survey

Before making changes to these areas, fetch the latest docs:

| Area | When to survey | What to search |
|------|---------------|----------------|
| **Skills** | Adding/modifying SKILL.md files | "Claude Code SKILL.md frontmatter" at code.claude.com/docs/en/skills |
| **Hooks** | Adding/modifying hook scripts or hooks.json | "Claude Code hooks" at code.claude.com/docs/en/hooks |
| **Plugin manifest** | Changing plugin.json | "Claude Code plugin.json" at code.claude.com/docs/en/plugins-reference |
| **Settings** | Changing settings.json | "Claude Code settings" at code.claude.com/docs/en/settings |
| **MCP protocol** | Adding/modifying MCP tools or server wiring | "MCP specification tools" at modelcontextprotocol.io |
| **Bun APIs** | Using Bun-specific APIs (test runner, FFI, bundler) | "Bun [topic]" at bun.sh/docs |
| **Zod** | Complex schema patterns | "Zod [pattern]" at zod.dev |

## Why

These specs evolve on ~monthly cycles. Hardcoded knowledge from training data or previous sessions is likely stale. The cost of a web search is trivial compared to debugging a spec mismatch.

## Reference

Canonical URLs are maintained in `docs/reference-urls.md`.
