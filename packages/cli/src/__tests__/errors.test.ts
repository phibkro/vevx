import { describe, expect, it } from "bun:test";

import { formatError } from "../errors";

describe("Error Formatting", () => {
  it("formats rate limit error with retry time and solutions", () => {
    const error = new Error("Rate limit exceeded");
    error.name = "RateLimitError";
    (error as any).retryAfter = 60;

    const output = formatError(error);

    expect(output).toContain("Rate Limit");
    expect(output).toContain("60");
    expect(output).toContain("Wait");
    expect(output).toContain("✗");
    expect(output).toContain("Solutions");
    expect(output).toContain("Reduce");
    expect(output).toContain("Upgrade");
  });

  it("formats authentication error with help URL and solutions", () => {
    const error = new Error("Invalid API key");
    error.name = "AuthenticationError";
    (error as any).helpUrl = "https://console.anthropic.com/";

    const output = formatError(error);

    expect(output).toContain("Authentication");
    expect(output).toContain("API key");
    expect(output).toContain("https://console.anthropic.com/");
    expect(output).toContain("✗");
    expect(output).toContain("Solutions");
    expect(output).toContain("ANTHROPIC_API_KEY");
    expect(output).toContain("export");
  });

  it("formats validation error", () => {
    const error = new Error("Path does not exist");
    error.name = "ValidationError";

    const output = formatError(error);

    expect(output).toContain("Validation");
    expect(output).toContain("Path does not exist");
    expect(output).toContain("✗");
  });

  it("formats unknown errors gracefully", () => {
    const error = new Error("Unknown problem");

    const output = formatError(error);

    expect(output).toContain("Error");
    expect(output).toContain("Unknown problem");
    expect(output).toContain("✗");
    expect(output).toContain("github.com");
  });

  it("handles errors without messages", () => {
    const error = new Error();

    const output = formatError(error);

    expect(output).toContain("Error");
    expect(output).toContain("✗");
  });
});
