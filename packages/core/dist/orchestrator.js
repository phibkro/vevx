import { agents } from "./agents/index";
import { callClaude } from "./client";
/**
 * Run a single agent on the provided files
 */
async function runAgent(agent, files, options) {
    const startTime = Date.now();
    try {
        // Generate user prompt from files
        const userPrompt = agent.userPromptTemplate(files);
        // Call Claude API
        const rawResponse = await callClaude(agent.systemPrompt, userPrompt, {
            model: options.model,
            maxTokens: options.maxTokens || 4096,
        });
        // Parse response
        const result = agent.parseResponse(rawResponse);
        // Set actual duration
        result.durationMs = Date.now() - startTime;
        return result;
    }
    catch (error) {
        // If agent fails, return error result
        const durationMs = Date.now() - startTime;
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Agent ${agent.name} failed: ${errorMessage}`);
        return {
            agent: agent.name,
            score: 0,
            findings: [
                {
                    severity: "critical",
                    title: `Agent ${agent.name} failed`,
                    description: `Analysis failed with error: ${errorMessage}`,
                    file: "unknown",
                },
            ],
            summary: `Agent failed to complete analysis: ${errorMessage}`,
            durationMs,
        };
    }
}
/**
 * Run all agents in parallel on the provided files
 */
export async function runAudit(files, options, onProgress) {
    console.log(`\nRunning ${agents.length} agents in parallel...`);
    const startTime = Date.now();
    // Emit started event
    onProgress?.({ type: 'started', agentCount: agents.length });
    // Run all agents in parallel using Promise.allSettled
    // This ensures that if one agent fails, others continue
    const results = await Promise.allSettled(agents.map(async (agent) => {
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
    }));
    const totalDuration = Date.now() - startTime;
    // Extract results (both successful and failed)
    const agentResults = results.map((result, index) => {
        const agent = agents[index];
        if (result.status === "fulfilled") {
            return result.value;
        }
        else {
            // Promise was rejected
            console.error(`Agent ${agent.name} promise rejected: ${result.reason}`);
            return {
                agent: agent.name,
                score: 0,
                findings: [
                    {
                        severity: "critical",
                        title: `Agent ${agent.name} promise rejected`,
                        description: `Promise was rejected: ${result.reason}`,
                        file: "unknown",
                    },
                ],
                summary: `Agent failed: ${result.reason}`,
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
        console.log(`  ${status} ${result.agent.padEnd(15)} - ${duration}s - Score: ${result.score.toFixed(1)}/10 - ${result.findings.length} findings`);
    });
    return agentResults;
}
/**
 * Calculate weighted average score across all agents
 */
export function calculateOverallScore(results) {
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
//# sourceMappingURL=orchestrator.js.map