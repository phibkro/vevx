# Documentation

AI Code Auditor documentation index.

## Quick Links

- **[Quick Start](QUICK-START.md)** - Get up and running (AI agents start here)
- **[Architecture](ARCHITECTURE.md)** - Multi-agent system design
- **[Development](DEVELOPMENT.md)** - Developer workflows and monorepo structure

## Component Documentation

### CLI Tool
- **[Building Binaries](../apps/cli/docs/BUILDING.md)** - Compile standalone executables
- **[CLI Architecture](../apps/cli/docs/README.md)** - How the CLI works

### Web Dashboard
- **[Dashboard Setup](../apps/web/docs/SETUP.md)** - Deploy the web dashboard
- **[API Documentation](../apps/web/docs/API.md)** - REST API reference

### Core Package
- **[Agent System](../packages/core/docs/AGENTS.md)** - How agents work
- **[Adding Agents](../packages/core/docs/ADDING-AGENTS.md)** - Create new agents

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
