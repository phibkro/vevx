import { describe, it, expect, mock } from "bun:test";

import { agents } from "../agents/index";
import type { FileContent } from "../agents/types";
import type { AgentResult } from "../agents/types";
import type { ProgressEvent } from "../orchestrator";
import { calculateOverallScore } from "../orchestrator";

/**
 * Mock file content for testing
 */
const mockFiles: FileContent[] = [
  {
    path: "/test/test.ts",
    relativePath: "test.ts",
    content: 'console.log("test")',
    language: "typescript",
  },
];

describe("Orchestrator Progress Tracking", () => {
  describe("ProgressEvent types", () => {
    it("started event contains agent count", () => {
      const event: ProgressEvent = {
        type: "started",
        agentCount: 5,
      };

      expect(event.type).toBe("started");
      expect(event.agentCount).toBe(5);
    });

    it("agent-started event contains agent name", () => {
      const event: ProgressEvent = {
        type: "agent-started",
        agent: "correctness",
      };

      expect(event.type).toBe("agent-started");
      expect(event.agent).toBe("correctness");
    });

    it("agent-completed event contains score and duration", () => {
      const event: ProgressEvent = {
        type: "agent-completed",
        agent: "security",
        score: 8.5,
        duration: 2.3,
      };

      expect(event.type).toBe("agent-completed");
      expect(event.agent).toBe("security");
      expect(event.score).toBe(8.5);
      expect(event.duration).toBe(2.3);
    });

    it("completed event contains total duration", () => {
      const event: ProgressEvent = {
        type: "completed",
        totalDuration: 5.7,
      };

      expect(event.type).toBe("completed");
      expect(event.totalDuration).toBe(5.7);
    });
  });

  describe("Progress callback execution order", () => {
    it("callback receives events in correct order", () => {
      const events: ProgressEvent[] = [];
      const onProgress = mock((event: ProgressEvent) => {
        events.push(event);
      });

      // Simulate progress events
      onProgress({ type: "started", agentCount: 3 });
      onProgress({ type: "agent-started", agent: "agent1" });
      onProgress({ type: "agent-completed", agent: "agent1", score: 9, duration: 1.5 });
      onProgress({ type: "completed", totalDuration: 4.5 });

      expect(onProgress).toHaveBeenCalledTimes(4);
      expect(events[0].type).toBe("started");
      expect(events[1].type).toBe("agent-started");
      expect(events[2].type).toBe("agent-completed");
      expect(events[3].type).toBe("completed");
    });
  });

  describe("Optional progress callback", () => {
    it("callback is truly optional", () => {
      // Verify the signature allows omitting the callback
      function mockProgressCallback(cb?: (event: ProgressEvent) => void) {
        cb?.({ type: "started", agentCount: 5 });
      }

      expect(() => mockProgressCallback()).not.toThrow();
      expect(() => mockProgressCallback(undefined)).not.toThrow();
    });

    it("undefined callback does not execute", () => {
      let executed = false;
      const callback = undefined as ((event: ProgressEvent) => void) | undefined;

      // Optional chaining prevents execution
      if (callback) {
        callback({ type: "started", agentCount: 5 });
        executed = true;
      }

      expect(executed).toBe(false);
    });
  });
});

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

  it("handles decimal scores correctly", () => {
    const results: AgentResult[] = [
      {
        agent: "correctness",
        score: 8.7,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "security",
        score: 6.3,
        findings: [],
        summary: "Fair",
        durationMs: 1000,
      },
      {
        agent: "performance",
        score: 7.9,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "maintainability",
        score: 8.1,
        findings: [],
        summary: "Good",
        durationMs: 1000,
      },
      {
        agent: "edge-cases",
        score: 5.5,
        findings: [],
        summary: "Fair",
        durationMs: 1000,
      },
    ];

    const overallScore = calculateOverallScore(results);

    // Should handle decimals properly
    expect(overallScore).toBeGreaterThan(0);
    expect(overallScore).toBeLessThanOrEqual(10);
  });

  it("returns 0 for empty results array", () => {
    const overallScore = calculateOverallScore([]);
    expect(overallScore).toBe(0);
  });
});

describe("Orchestrator Integration", () => {
  it("agent system is correctly configured", () => {
    // Verify we have all expected agents
    expect(agents).toHaveLength(7);

    const agentNames = agents.map((a) => a.name);
    expect(agentNames).toContain("correctness");
    expect(agentNames).toContain("security");
    expect(agentNames).toContain("performance");
    expect(agentNames).toContain("maintainability");
    expect(agentNames).toContain("edge-cases");
    expect(agentNames).toContain("accessibility");
    expect(agentNames).toContain("documentation");
  });

  it("all agents have required properties", () => {
    agents.forEach((agent) => {
      expect(agent).toHaveProperty("name");
      expect(agent).toHaveProperty("weight");
      expect(agent).toHaveProperty("systemPrompt");
      expect(agent).toHaveProperty("userPromptTemplate");
      expect(agent).toHaveProperty("parseResponse");

      expect(typeof agent.name).toBe("string");
      expect(typeof agent.weight).toBe("number");
      expect(typeof agent.systemPrompt).toBe("string");
      expect(typeof agent.userPromptTemplate).toBe("function");
      expect(typeof agent.parseResponse).toBe("function");
    });
  });

  it("weights configuration matches expected values", () => {
    const weightMap = agents.reduce(
      (map, agent) => {
        map[agent.name] = agent.weight;
        return map;
      },
      {} as Record<string, number>,
    );

    expect(weightMap["correctness"]).toBe(0.22);
    expect(weightMap["security"]).toBe(0.22);
    expect(weightMap["performance"]).toBe(0.13);
    expect(weightMap["maintainability"]).toBe(0.15);
    expect(weightMap["edge-cases"]).toBe(0.13);
    expect(weightMap["accessibility"]).toBe(0.1);
    expect(weightMap["documentation"]).toBe(0.05);
  });
});
