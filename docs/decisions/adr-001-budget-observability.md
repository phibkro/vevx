# ADR-001: Reframe Token Budgets from Enforcement to Observability

**Status:** Accepted
**Date:** 2026-02-18
**Deciders:** @phibkro

## Context

The design document (v0.1.0) specified per-task token and time budgets as runtime constraints. The orchestrator would set budgets at dispatch time, monitor consumption during execution, and flag or terminate tasks approaching limits. The planner was responsible for estimating budgets based on task complexity.

This was motivated by the process execution model: agents consume resources like OS processes, and unbounded contract-mode tasks could produce runaway costs.

## Problem

Three issues emerged during implementation:

1. **Platform limitation.** Claude Code does not expose token counting or subagent termination APIs. Budget enforcement is not mechanically possible in the current platform.

2. **Estimation accuracy.** The planner has no reliable basis for predicting token consumption. Estimates depend on the agent's approach, codebase complexity, tool call patterns, and context window pressure — none of which are known at planning time. Early estimates would be systematically wrong, and the feedback loop for calibration crosses session boundaries.

3. **Asymmetric failure modes.** Budgets set too tight cut off useful work mid-task (expensive to recover from — the agent has already consumed tokens and produced partial state). Budgets set too loose are never the binding constraint (the context window or user spend limits hit first). There is no sweet spot where enforcement adds value over the platform's existing ceilings.

## Decision

**Drop budget enforcement from the plan schema and orchestrator protocol.** Reframe token/time tracking as process accounting — an observability concern, not a control mechanism.

Specifically:
- Remove `<budget>` elements from the plan XML schema
- Remove budget-setting from the planner protocol
- Remove Budget and Monitor steps from the orchestrator's chain of thought
- Track actual resource consumption as execution metrics (process accounting)
- Surface consumption data in execution summaries for medium loop review

## Consequences

**Positive:**
- Simpler plan schema (fewer fields for the planner to estimate incorrectly)
- Simpler orchestrator protocol (12 steps instead of 14)
- No false sense of control from unenforceable limits
- Execution cost data still available for medium loop calibration

**Negative:**
- No automated protection against runaway tasks (relies on Claude Code's own context window limits and user spend controls)
- The planner loses a structured field for communicating "this task should be small" — must express scope constraints in the task description instead

**Neutral:**
- The audit package's `--budget` flag is unaffected — that's a user-specified cost ceiling for a whole audit run, a different concept from per-task estimation
- If Claude Code later exposes token counting and subagent termination APIs, enforcement can be reconsidered as an additive feature without schema changes

## Alternatives Considered

**Keep budgets as advisory (declare but don't enforce).** Rejected because advisory budgets still require the planner to produce estimates, creating a maintenance burden for data nobody acts on. If the data is useful, it should come from observation (actual consumption), not prediction (estimated budgets).

**Move budget to the orchestrator skill only (not the plan schema).** Rejected for the same reason — the orchestrator would still need a basis for setting limits, and that basis doesn't exist without execution history.

## Related

- Design principles §2.2 (Process Execution Model) — process accounting paragraph
- Design architecture §3.2 (Plan Format) — plan schema
- Design architecture §3.3 (Orchestrator) — chain of thought protocol
- Design notes §7.6 (Budget Calibration) — open question, now reframed as "Execution Cost Visibility"
