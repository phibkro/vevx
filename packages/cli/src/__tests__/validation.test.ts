import { afterEach, describe, expect, it } from "bun:test";

import { validateInput } from "../validation";

describe("Input Validation", () => {
  const originalEnv = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    // Restore original env
    if (originalEnv) {
      process.env.ANTHROPIC_API_KEY = originalEnv;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
  });

  it("validates that path exists", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    expect(() => validateInput("/nonexistent/path/that/does/not/exist")).toThrow(/does not exist/);
  });

  it("accepts existing paths", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    // Use current directory which definitely exists
    expect(() => validateInput(".")).not.toThrow();
    expect(() => validateInput(__dirname)).not.toThrow();
  });

  it("validates API key exists", () => {
    delete process.env.ANTHROPIC_API_KEY;

    expect(() => validateInput(".")).toThrow(/API key/);
  });

  it("validates API key is not empty", () => {
    process.env.ANTHROPIC_API_KEY = "";

    expect(() => validateInput(".")).toThrow(/API key/);
  });

  it("returns normalized path when validation passes", () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    const result = validateInput(".");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });
});
