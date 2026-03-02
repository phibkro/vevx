---
"@vevx/kart": patch
"@vevx/kiste": patch
"@vevx/varp": patch
---

Fix issues found during CodeRabbit review across all packages.

**kart:** Fix FiberFailure unwrapping in `isPluginUnavailable`, fix stale registry reference in `makeLspRuntimes`, extract `registerLspTool` helper reducing ~224 lines of boilerplate.

**kiste:** Fix transaction rollback using Effect error channel, fix snapshot sort by mtime instead of SHA, replace `as unknown as` casts with `sql.unsafe<T>()` generics, fix version string to 0.2.0.

**varp:** Deep-freeze cached manifests to prevent cache poisoning, remove broken Stop prompt hook and obsolete SubagentStart hook, consolidate subagent-conventions into CLAUDE.md.
