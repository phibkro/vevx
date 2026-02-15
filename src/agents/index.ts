import { correctnessAgent } from "./correctness.ts";
import { securityAgent } from "./security.ts";
import { performanceAgent } from "./performance.ts";
import { maintainabilityAgent } from "./maintainability.ts";
import { edgeCasesAgent } from "./edge-cases.ts";

export type { AgentDefinition, AgentResult, Finding, Severity } from "./types.ts";

/**
 * All available agents for code analysis
 */
export const agents = [
  correctnessAgent,
  securityAgent,
  performanceAgent,
  maintainabilityAgent,
  edgeCasesAgent,
];

/**
 * Validate that agent weights sum to 1.0
 */
function validateWeights(): void {
  const totalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0);
  const tolerance = 0.0001; // Allow tiny floating point errors

  if (Math.abs(totalWeight - 1.0) > tolerance) {
    throw new Error(
      `Agent weights must sum to 1.0, but got ${totalWeight}. ` +
        `Weights: ${agents.map((a) => `${a.name}=${a.weight}`).join(", ")}`
    );
  }
}

// Validate weights on module load
validateWeights();
