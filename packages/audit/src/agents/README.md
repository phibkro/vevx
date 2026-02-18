# Audit Agents

Specialized Claude-powered agents for code review. Each agent focuses on a single quality dimension.

## Active Agents

| Agent | Weight | Focus |
|-------|--------|-------|
| Correctness | 22% | Logic errors, type safety, data handling |
| Security | 22% | Vulnerabilities, injection, auth flaws |
| Maintainability | 15% | Code structure, complexity, readability |
| Performance | 13% | Bottlenecks, resource usage, scaling |
| Edge Cases | 13% | Boundary conditions, error paths, race conditions |
| Accessibility | 10% | WCAG compliance, screen readers, keyboard navigation |
| Documentation | 5% | Missing/misleading docs, API contracts |

Dependency Security agent exists but is disabled by default (weight 0).

## Agent Interface

Each agent implements `AgentDefinition`:

- `name` — Agent identifier
- `weight` — Score contribution (all weights must sum to 1.0, validated at module load)
- `systemPrompt` — Defines the agent's expertise and analysis approach
- `userPromptTemplate` — Template for per-chunk review prompts
- `parseResponse()` — Extracts structured `Finding[]` from Claude's response

## Finding Schema

```ts
interface Finding {
  title: string;
  severity: "Critical" | "High" | "Medium" | "Low" | "Informational";
  file: string;
  line?: number;
  description: string;
  suggestion?: string;
}
```
