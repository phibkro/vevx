# Architecture

## Why Multi-Agent?

- **Specialization**: Each agent focuses on one quality dimension for deeper analysis
- **Parallelization**: Independent agents run simultaneously via `Promise.allSettled`
- **Resilience**: One agent failure doesn't abort the audit (returns score=0 with error findings)
- **Extensibility**: New agents added without modifying existing ones (weight rebalancing required)

Agents don't communicate with each other. Each receives the same files independently.

## Scoring

Each agent returns 0-10. Overall score = `sum(score * weight) / sum(weights)`.

## Chunking

Large codebases exceeding token limits are split into chunks. Files are never split across chunks. Agents process each chunk independently, results merged. **Limitation**: cross-file issues may be missed.

## Data Model

```
User ──< TeamMember >── Team
                         ├──< Audit ──< Finding
                         └──< ApiKey (bcrypt hashed)
```

Cascade deletes: Team deletion removes all related data.

Plans: FREE (5 audits/month, 1 member), PRO ($39, unlimited), TEAM ($249, 5 members).

## Platform Split

CLI uses Bun native APIs for performance. GitHub Action runs in Node.js. This requires two discovery implementations — see CLAUDE.md.

## Configuration

User config via `.code-audit.json` merged with CLI flags. Agent weights hardcoded in definitions, validated on load.
