import type { ProgressEvent } from "@varp/audit";

import ora from "ora";

export function createProgressReporter() {
  let spinner: any = null;
  const completed: string[] = [];

  return {
    onProgress(event: ProgressEvent) {
      if (event.type === "started") {
        console.log(`\nRunning ${event.agentCount} agents...\n`);
      }

      if (event.type === "agent-started") {
        spinner = ora(`Analyzing: ${event.agent}`).start();
      }

      if (event.type === "agent-completed") {
        if (spinner) {
          spinner.stop();
          spinner = null;
        }
        const duration = event.duration?.toFixed(1) || "0.0";
        const score = event.score?.toFixed(1) || "0.0";
        console.log(`  ✓ ${event.agent?.padEnd(15)} [${duration}s] Score: ${score}/10`);
        if (event.agent) {
          completed.push(event.agent);
        }
      }

      if (event.type === "completed") {
        const duration = event.totalDuration?.toFixed(1) || "0.0";
        console.log(`\nCompleted in ${duration}s\n`);
      }
    },

    get isSpinning() {
      return spinner !== null;
    },

    getCompleted() {
      return [...completed];
    },
  };
}
