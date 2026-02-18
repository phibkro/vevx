# Contributing to AI Code Auditor

Thank you for your interest in contributing! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, inclusive, and professional. We're all here to build something useful together.

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally
3. **Set up development environment**: See [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md)
4. **Create a branch** for your changes: `git checkout -b feature/your-feature-name`

## Development Workflow

### Before You Start

- **Check existing issues**: See if someone is already working on it
- **Open an issue**: For bugs or feature requests, discuss before coding
- **Small PRs**: Break large changes into smaller, focused pull requests

### Making Changes

```bash
# Create feature branch
git checkout -b feature/amazing-feature

# Make your changes
# ...

# Run tests
bun run test

# Build to verify
bun run build

# Lint your code
bun run lint
```

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add user authentication
fix: resolve null pointer in audit sync
docs: update API documentation
test: add tests for security agent
refactor: simplify chunking logic
chore: update dependencies
```

**Structure**:
```
<type>(<scope>): <subject>

<body>

<footer>
```

**Types**:
- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation only
- `test`: Adding or updating tests
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `chore`: Changes to build process or auxiliary tools

### Pull Request Process

1. **Update documentation** if you changed APIs or behavior
2. **Add tests** for new features or bug fixes
3. **Ensure tests pass**: `bun run test`
4. **Ensure builds succeed**: `bun run build`
5. **Update CHANGELOG** if applicable
6. **Create pull request** with clear description

**PR Title**: Use conventional commit format
**PR Description**: Explain what, why, and how

Example:
```markdown
## What
Adds caching for repeated code analysis to improve performance.

## Why
Users frequently audit the same codebase multiple times. Caching results
significantly improves performance for subsequent audits.

## How
- Implemented LRU cache in core package
- Cache key based on file content hash
- Added cache invalidation on file changes
- Added tests for cache behavior

## Testing
- Added unit tests for cache module
- Verified performance improvement in manual testing
- All existing tests pass
```

## What to Contribute

### Good First Issues

Look for issues labeled `good-first-issue`:
- Documentation improvements
- Test coverage
- Small bug fixes
- UI/UX improvements

### High-Value Contributions

- **New agents**: Additional code quality dimensions
- **Language support**: Parsers for new programming languages
- **Performance**: Optimize agent execution or chunking
- **Testing**: Improve test coverage
- **Documentation**: Tutorials, examples, guides

### Not Accepted

- Breaking changes without prior discussion
- Massive refactors without incremental steps
- Features that significantly increase complexity
- Changes that don't align with project goals

## Code Standards

### TypeScript

- **Strict mode**: Always enabled
- **Types**: Prefer explicit types over `any`
- **Interfaces**: Use interfaces for object shapes
- **Enums**: Use for fixed sets of values

### React/Next.js

- **Server Components**: Default (use `"use client"` sparingly)
- **File organization**: Group by feature, not type
- **API routes**: Validate input with Zod
- **Error handling**: Always handle errors gracefully

### Testing

- **Unit tests**: For business logic and utilities
- **Integration tests**: For API endpoints
- **E2E tests**: For critical user journeys
- **Coverage**: Aim for >80% on new code

### Security

- **Never commit secrets**: Use environment variables
- **Validate input**: All user input must be validated
- **Rate limiting**: All public endpoints must be rate-limited
- **SQL injection**: Use parameterized queries (Prisma handles this)
- **XSS**: Sanitize user-generated content

## Testing Guidelines

### Running Tests

```bash
# All tests
bun run test

# Specific package
cd apps/web && bun test

# Watch mode
cd apps/web && bun test --watch

# E2E tests
cd apps/web && bun run test:e2e

# Coverage
cd apps/web && bun run test:coverage
```

### Writing Tests

**Unit tests** (`test/` directory):
```typescript
import { describe, test, expect } from 'vitest'

describe('MyFunction', () => {
  test('handles valid input', () => {
    const result = myFunction('input')
    expect(result).toBe('expected')
  })

  test('throws on invalid input', () => {
    expect(() => myFunction(null)).toThrow()
  })
})
```

**E2E tests** (`e2e/` directory):
```typescript
import { test, expect } from '@playwright/test'

test('user can sign up', async ({ page }) => {
  await page.goto('/sign-up')
  await page.fill('[name="email"]', 'test@example.com')
  await page.click('button[type="submit"]')
  await expect(page).toHaveURL('/dashboard')
})
```

## Documentation Standards

### Code Comments

- **When to comment**: Complex algorithms, non-obvious decisions, "why" not "what"
- **When not to**: Self-explanatory code, redundant descriptions
- **JSDoc**: For public APIs and exported functions

### Markdown Documentation

- **Clarity**: Write for beginners, not experts
- **Examples**: Include code examples
- **Structure**: Use headings, lists, code blocks
- **Links**: Link to related documentation

## Adding a New Agent

Complete example of adding a new agent:

1. **Create agent file** (`packages/core/src/agents/naming.ts`):
```typescript
import type { FileContent } from "@code-auditor/types"
import type { AgentDefinition } from "./types"

export const namingAgent: AgentDefinition = {
  name: "naming",
  weight: 0.10,  // Adjust other agents to sum to 1.0
  systemPrompt: `You are a naming specialist...`,
  userPromptTemplate: (files: FileContent[]) => {
    // Format files for analysis
  },
  parseResponse: (raw: string) => {
    // Parse Claude's response
  }
}
```

2. **Export agent** (`packages/core/src/agents/index.ts`):
```typescript
import { namingAgent } from "./naming"

export const agents = [
  correctnessAgent,
  securityAgent,
  performanceAgent,
  maintainabilityAgent,
  edgeCasesAgent,
  namingAgent,  // Add here
]
```

3. **Adjust weights**: Ensure all agent weights sum to 1.0

4. **Add tests** (`packages/core/src/agents/__tests__/naming.test.ts`)

5. **Update documentation**: Add agent description to README.md

## Performance Guidelines

- **Avoid premature optimization**: Profile first
- **Parallel execution**: Use `Promise.all` for independent operations
- **Caching**: Cache expensive computations
- **Lazy loading**: Load modules only when needed
- **Database queries**: Use indexes, avoid N+1 queries

## Questions?

- **Documentation**: Check [docs/](docs/) first
- **Issues**: Open a GitHub issue
- **Discussions**: Use GitHub Discussions for questions
- **Security**: Email security@example.com (do not open public issues)

## Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes for significant contributions
- README acknowledgments section

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
