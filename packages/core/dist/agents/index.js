import { correctnessAgent } from "./correctness";
import { securityAgent } from "./security";
import { performanceAgent } from "./performance";
import { maintainabilityAgent } from "./maintainability";
import { edgeCasesAgent } from "./edge-cases";
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
function validateWeights() {
    const totalWeight = agents.reduce((sum, agent) => sum + agent.weight, 0);
    const tolerance = 0.0001; // Allow tiny floating point errors
    if (Math.abs(totalWeight - 1.0) > tolerance) {
        throw new Error(`Agent weights must sum to 1.0, but got ${totalWeight}. ` +
            `Weights: ${agents.map((a) => `${a.name}=${a.weight}`).join(", ")}`);
    }
}
// Validate weights on module load
validateWeights();
//# sourceMappingURL=index.js.map