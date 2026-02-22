import { describe, expect, it } from "bun:test";

import { TaskResultSchema } from "./types.js";

describe("TaskResultSchema", () => {
  it("parses a complete result", () => {
    const result = TaskResultSchema.parse({
      status: "COMPLETE",
      metrics: {
        tokens_used: 5000,
        duration_ms: 12000,
      },
      files_modified: ["src/auth/login.ts"],
      observations: ["Refactored login handler to use async/await"],
    });
    expect(result.status).toBe("COMPLETE");
    expect(result.metrics?.tokens_used).toBe(5000);
    expect(result.files_modified).toHaveLength(1);
  });

  it("defaults optional fields", () => {
    const result = TaskResultSchema.parse({
      status: "COMPLETE",
    });
    expect(result.files_modified).toEqual([]);
    expect(result.observations).toEqual([]);
    expect(result.metrics).toBeUndefined();
    expect(result.error).toBeUndefined();
  });

  it("accepts all status values", () => {
    for (const status of ["COMPLETE", "PARTIAL", "BLOCKED", "NEEDS_REPLAN"] as const) {
      expect(TaskResultSchema.parse({ status }).status).toBe(status);
    }
  });

  it("captures error on failure statuses", () => {
    const result = TaskResultSchema.parse({
      status: "BLOCKED",
      error: "Missing API credentials",
    });
    expect(result.error).toBe("Missing API credentials");
  });
});
