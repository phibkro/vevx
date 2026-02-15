# Documentation

AI Code Auditor documentation index.

## Quick Links

- **[Quick Start](QUICK-START.md)** - Get up and running (AI agents start here)
- **[Architecture](ARCHITECTURE.md)** - Multi-agent system design
- **[Development](DEVELOPMENT.md)** - Developer workflows and monorepo structure
- **[Agent Driven Development](agent-driven-development/)** - How AI agents build this project

## Agent Driven Development (ADD)

This project uses **Agent Driven Development** - AI agents orchestrated by Claude:

- **[ADD Overview](agent-driven-development/README.md)** - What is Agent Driven Development?
- **[Prioritization](agent-driven-development/PRIORITIZATION.md)** - Dependency graph & execution plan
- **[Software Practices](agent-driven-development/SOFTWARE-PRACTICES.md)** - Practices for AI agent teams
- **[Implementation Plans](agent-driven-development/backlog/)** - Detailed PLANs for each feature

## Component Documentation

### CLI Tool
- **[Building Binaries](../apps/cli/docs/BUILDING.md)** - Compile standalone executables

### Web Dashboard
- **[Dashboard Deployment](../apps/web/docs/DEPLOYMENT.md)** - Deploy to Vercel

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for contribution guidelines.

## Project Structure

```
ai-code-auditor/
├── docs/                      # Project-wide documentation
├── apps/
│   ├── cli/docs/              # CLI-specific docs
│   ├── web/docs/              # Web dashboard docs
│   └── action/                # GitHub Action
├── packages/
│   └── core/docs/             # Core package docs (agents, orchestrator)
└── CLAUDE.md                  # AI assistant context (root level)
```

Documentation follows the principle of **colocation** - docs are kept close to what they document.
