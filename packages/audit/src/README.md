# Audit Core

Multi-agent compliance audit engine. Runs specialized Claude-powered agents against a codebase to produce structured security and quality findings.

## Architecture

```
Ruleset (markdown)  →  Planner  →  Audit Plan (waves + tasks)
                                        ↓
Source files        →  Chunker  →  Orchestrator  →  Agents  →  Report
                                        ↓
                                   Claude API (client.ts)
```

## Key Modules

| Module | Purpose |
|--------|---------|
| `orchestrator.ts` | Runs agents against file chunks, scores results |
| `client.ts` | Claude API wrapper with retry logic |
| `chunker.ts` | Splits source files into token-bounded chunks |
| `discovery-node.ts` | Finds source files in a project directory |
| `report/` | Formats findings into markdown/JSON reports |
| `errors.ts` | Domain error types |
| `planner/` | Audit planning from rulesets (see `planner/README.md`) |
| `agents/` | Specialized review agents (see `agents/README.md`) |

## Orchestrator

`runAudit()` is the main entry point. It:

1. Runs each agent against the provided files
2. Collects findings with severity levels
3. Calculates per-agent and overall scores (weighted by agent importance)
4. Emits progress events during execution

Options: `model` (Claude model ID) and `maxTokens` (per-call budget).

## Status

Experimental. Not yet integrated with `@varp/core` scheduling.
