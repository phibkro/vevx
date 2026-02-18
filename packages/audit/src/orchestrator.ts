import type { FileContent } from "./agents/types";
import type { AgentResult } from "./agents/types";
import { agents } from "./agents/index";
import { callClaude } from "./client";

export interface OrchestratorOptions {
  model: string;
  maxTokens?: number;
}

/**
 * Progress event types emitted during audit execution
 */
export type ProgressEvent =
  | { type: 'started'; agentCount: number }
  | { type: 'agent-started'; agent: string }
  | { type: 'agent-completed'; agent: string; score: number; duration: number }
  | { type: 'completed'; totalDuration: number }

/**
 * Run a single agent on the provided files
 */
async function runAgent(
  agent: any,
  files: FileContent[],
  options: OrchestratorOptions
): Promise<AgentResult> {
  const startTime = Date.now();

  try {
    // Generate user prompt from files
    const userPrompt = agent.userPromptTemplate(files);

    // Call Claude API
    const rawResponse = await callClaude(
      agent.systemPrompt,
      userPrompt,
      {
        model: options.model,
        maxTokens: options.maxTokens || 4096,
      }
    );

    // Parse response
    const result = agent.parseResponse(rawResponse);

    // Set actual duration
    result.durationMs = Date.now() - startTime;

    return result;
  } catch (error) {
    // If agent fails, return error result with sanitized message
    const durationMs = Date.now() - startTime;

    console.error(`Agent ${agent.name} failed:`, error);

    return {
      agent: agent.name,
      score: 0,
      findings: [
        {
          severity: "critical",
          title: `Agent ${agent.name} failed`,
          description: "Analysis could not be completed. See server logs for details.",
          file: "unknown",
        },
      ],
      summary: "Agent failed to complete analysis.",
      durationMs,
    };
  }
}

/**
 * Run all agents in parallel on the provided files
 */
export async function runAudit(
  files: FileContent[],
  options: OrchestratorOptions,
  onProgress?: (event: ProgressEvent) => void
): Promise<AgentResult[]> {
  console.log(`\nRunning ${agents.length} agents in parallel...`);

  const startTime = Date.now();

  // Emit started event
  onProgress?.({ type: 'started', agentCount: agents.length });

  // Run all agents in parallel using Promise.allSettled
  // This ensures that if one agent fails, others continue
  const results = await Promise.allSettled(
    agents.map(async (agent) => {
      const agentStartTime = Date.now();

      // Emit agent-started event
      onProgress?.({ type: 'agent-started', agent: agent.name });

      const result = await runAgent(agent, files, options);
      const duration = (Date.now() - agentStartTime) / 1000;

      // Emit agent-completed event
      onProgress?.({
        type: 'agent-completed',
        agent: agent.name,
        score: result.score,
        duration,
      });

      return result;
    })
  );

  const totalDuration = Date.now() - startTime;

  // Extract results (both successful and failed)
  const agentResults: AgentResult[] = results.map((result, index) => {
    const agent = agents[index];

    if (result.status === "fulfilled") {
      return result.value;
    } else {
      // Promise was rejected — log full detail, return sanitized message
      console.error(`Agent ${agent.name} promise rejected:`, result.reason);
      return {
        agent: agent.name,
        score: 0,
        findings: [
          {
            severity: "critical",
            title: `Agent ${agent.name} failed`,
            description: "Agent task was rejected. See server logs for details.",
            file: "unknown",
          },
        ],
        summary: "Agent failed to complete analysis.",
        durationMs: 0,
      };
    }
  });

  console.log(`All agents completed in ${(totalDuration / 1000).toFixed(2)}s`);

  // Emit completed event
  onProgress?.({ type: 'completed', totalDuration: totalDuration / 1000 });

  // Log individual agent performance
  agentResults.forEach((result) => {
    const status = result.score > 0 ? "✓" : "✗";
    const duration = (result.durationMs / 1000).toFixed(2);
    console.log(
      `  ${status} ${result.agent.padEnd(15)} - ${duration}s - Score: ${result.score.toFixed(1)}/10 - ${result.findings.length} findings`
    );
  });

  return agentResults;
}

/**
 * Calculate weighted average score across all agents
 */
export function calculateOverallScore(results: AgentResult[]): number {
  let weightedSum = 0;
  let totalWeight = 0;

  results.forEach((result) => {
    const agent = agents.find((a) => a.name === result.agent);
    if (agent) {
      weightedSum += result.score * agent.weight;
      totalWeight += agent.weight;
    }
  });

  // If total weight is not 1.0, normalize
  return totalWeight > 0 ? weightedSum / totalWeight : 0;
}
