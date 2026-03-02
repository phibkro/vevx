import { describe, it, expect, mock } from "bun:test";

import { agents } from "../agents/index";
import type { AgentResult } from "../agents/types";
import type { FileContent } from "../agents/types";
import { calculateOverallScore, runAudit } from "../orchestrator";
import type { ProgressEvent } from "../orchestrator";
import type { ModelCaller } from "../planner/types";

describe("Orchestrator Score Calculation", () => {
  it("calculates weighted average correctly", () => {
    const results: AgentResult[] = [
      {
        agent: "correctness",
        score: 8,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "security",
        score: 6,
        findings: [],
        summary: "Fair",
        durationMs: 1000,
      },
      {
        agent: "performance",
        score: 7,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "maintainability",
        score: 8,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "edge-cases",
        score: 5,
        findings: [],
        summary: "Fair",
        durationMs: 1000,
      },
    ];

    const overallScore = calculateOverallScore(results);

    // Expected: (8*0.25 + 6*0.25 + 7*0.15 + 8*0.20 + 5*0.15)
    // = 2.0 + 1.5 + 1.05 + 1.6 + 0.75 = 6.9
    expect(overallScore).toBeCloseTo(6.9, 1);
  });

  it("handles all zeros", () => {
    const results: AgentResult[] = agents.map((agent) => ({
      agent: agent.name,
      score: 0,
      findings: [],
      summary: "Failed",
      durationMs: 0,
    }));

    const overallScore = calculateOverallScore(results);
    expect(overallScore).toBe(0);
  });

  it("handles all perfect scores", () => {
    const results: AgentResult[] = agents.map((agent) => ({
      agent: agent.name,
      score: 10,
      findings: [],
      summary: "Perfect",
      durationMs: 1000,
    }));

    const overallScore = calculateOverallScore(results);
    expect(overallScore).toBe(10);
  });

  it("handles missing agent in results", () => {
    // Only 3 agents instead of 5
    const results: AgentResult[] = [
      {
        agent: "correctness",
        score: 8,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "security",
        score: 7,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "performance",
        score: 9,
        findings: [],
        summary: "Great",
        durationMs: 1000,
      },
    ];

    const overallScore = calculateOverallScore(results);

    // Should only weight the agents that are present
    // (8*0.25 + 7*0.25 + 9*0.15) / (0.25 + 0.25 + 0.15)
    // = (2.0 + 1.75 + 1.35) / 0.65 = 5.1 / 0.65 = 7.846
    expect(overallScore).toBeCloseTo(7.85, 1);
  });

  it("handles unknown agent names", () => {
    const results: AgentResult[] = [
      {
        agent: "unknown-agent",
        score: 10,
        findings: [],
        summary: "Test",
        durationMs: 1000,
      },
    ];

    // Should return 0 when no known agents
    const overallScore = calculateOverallScore(results);
    expect(overallScore).toBe(0);
  });

  it("normalizes when weights do not sum to 1.0", () => {
    // Test with partial agent results
    const results: AgentResult[] = [
      {
        agent: "correctness",
        score: 8,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "security",
        score: 6,
        findings: [],
        summary: "Fair",
        durationMs: 1000,
      },
    ];

    const overallScore = calculateOverallScore(results);

    // Should normalize: (8*0.25 + 6*0.25) / (0.25 + 0.25) = 7.0
    expect(overallScore).toBeCloseTo(7.0, 1);
  });

  it("returns 0 for empty results array", () => {
    const overallScore = calculateOverallScore([]);
    expect(overallScore).toBe(0);
  });
});

// ── runAudit orchestration ──

describe("runAudit", () => {
  const mockFiles: FileContent[] = [
    {
      path: "/test/file.ts",
      relativePath: "file.ts",
      content: "const x = 1;",
      language: "typescript",
      size: 12,
    },
  ];

  function makeValidResponse(agentName: string, score: number): string {
    return JSON.stringify({
      score,
      summary: `${agentName} analysis complete`,
      findings: [],
    });
  }

  function makeMockCaller(
    responseFactory: (system: string, user: string) => string = () =>
      makeValidResponse("test", 7.5),
  ): ModelCaller {
    return mock(async (_system: string, user: string) => ({
      text: responseFactory(_system, user),
    })) as unknown as ModelCaller;
  }

  it("runs all agents and returns results", async () => {
    const caller = makeMockCaller((_sys, _user) => {
      // Each agent gets a valid response
      return makeValidResponse("agent", 8.0);
    });

    const results = await runAudit(mockFiles, { caller, model: "test-model" });

    expect(results).toHaveLength(agents.length);
    // Each agent should have returned a result
    const agentNames = results.map((r) => r.agent);
    for (const agent of agents) {
      expect(agentNames).toContain(agent.name);
    }
    // The mock was called once per agent
    expect(caller).toHaveBeenCalledTimes(agents.length);
  });

  it("returns score 0 for failed agents without blocking others", async () => {
    let callCount = 0;
    const caller = mock(async () => {
      callCount++;
      // First call (correctness) throws, rest succeed
      if (callCount === 1) {
        throw new Error("API timeout");
      }
      return { text: makeValidResponse("agent", 8.0) };
    }) as unknown as ModelCaller;

    const results = await runAudit(mockFiles, { caller, model: "test-model" });

    expect(results).toHaveLength(agents.length);
    // At least one agent should have score 0 (the failed one)
    const failedResults = results.filter((r) => r.score === 0);
    expect(failedResults.length).toBeGreaterThanOrEqual(1);
    // Failed agent should have a failure finding
    const failed = failedResults[0];
    expect(failed.findings).toHaveLength(1);
    expect(failed.findings[0].severity).toBe("critical");
    expect(failed.findings[0].title).toContain("failed");

    // Other agents should have succeeded
    const succeededResults = results.filter((r) => r.score > 0);
    expect(succeededResults.length).toBeGreaterThanOrEqual(agents.length - 1);
  });

  it("emits progress events in correct order", async () => {
    const caller = makeMockCaller();
    const events: ProgressEvent[] = [];
    const onProgress = mock((event: ProgressEvent) => events.push(event));

    await runAudit(mockFiles, { caller, model: "test-model" }, onProgress);

    // First event should be "started"
    expect(events[0].type).toBe("started");
    expect((events[0] as { agentCount: number }).agentCount).toBe(agents.length);

    // Last event should be "completed"
    const lastEvent = events[events.length - 1];
    expect(lastEvent.type).toBe("completed");

    // Should have agent-started and agent-completed for each agent
    const agentStarted = events.filter((e) => e.type === "agent-started");
    const agentCompleted = events.filter((e) => e.type === "agent-completed");
    expect(agentStarted).toHaveLength(agents.length);
    expect(agentCompleted).toHaveLength(agents.length);

    // Total events: 1 started + N agent-started + N agent-completed + 1 completed
    expect(events).toHaveLength(1 + agents.length * 2 + 1);
  });

  it("works without progress callback", async () => {
    const caller = makeMockCaller();

    // Should not throw when no callback provided
    const results = await runAudit(mockFiles, { caller, model: "test-model" });
    expect(results).toHaveLength(agents.length);
  });

  it("passes model and maxTokens to caller", async () => {
    const caller = mock(async () => ({
      text: makeValidResponse("agent", 8.0),
    })) as unknown as ModelCaller;

    await runAudit(mockFiles, { caller, model: "claude-test", maxTokens: 8192 });

    // Check that caller was invoked with correct options
    const calls = (caller as any).mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // Third argument is options: { model, maxTokens }
    const options = calls[0][2];
    expect(options.model).toBe("claude-test");
    expect(options.maxTokens).toBe(8192);
  });
});
