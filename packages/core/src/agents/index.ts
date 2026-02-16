import { correctnessAgent } from "./correctness";
import { securityAgent } from "./security";
import { performanceAgent } from "./performance";
import { maintainabilityAgent } from "./maintainability";
import { edgeCasesAgent } from "./edge-cases";
import { accessibilityAgent } from "./accessibility";
import { documentationAgent } from "./documentation";
// import { dependencySecurityAgent } from "./dependency-security"; // Disabled by default (weight=0.00)

export type { AgentDefinition, AgentResult, Finding, Severity } from "./types";

/**
 * All available agents for code analysis
 *
 * Weights (7 active agents):
 * - Correctness: 0.22 (22%)
 * - Security: 0.22 (22%)
 * - Performance: 0.13 (13%)
 * - Maintainability: 0.15 (15%)
 * - Edge Cases: 0.13 (13%)
 * - Accessibility: 0.10 (10%)
 * - Documentation: 0.05 (5%)
 *
 * Total: 1.00 (100%)
 */
export const agents = [
  correctnessAgent,
  securityAgent,
  performanceAgent,
  maintainabilityAgent,
  edgeCasesAgent,
  accessibilityAgent,
  documentationAgent,
  // dependencySecurityAgent, // Uncomment to enable (requires rebalancing weights)
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
