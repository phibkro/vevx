import { RateLimitError, AuthenticationError, ValidationError, AgentError } from "../errors";

describe("Error Classes", () => {
  describe("RateLimitError", () => {
    it("contains retry information", () => {
      const error = new RateLimitError(60);
      expect(error.name).toBe("RateLimitError");
      expect(error.retryAfter).toBe(60);
      expect(error.message).toContain("60");
    });

    it("message is actionable", () => {
      const error = new RateLimitError(120);
      expect(error.message).toContain("Rate limit");
      expect(error.message).toContain("120");
    });

    it("is instance of Error", () => {
      const error = new RateLimitError(30);
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(RateLimitError);
    });
  });

  describe("AuthenticationError", () => {
    it("contains help URL", () => {
      const error = new AuthenticationError();
      expect(error.name).toBe("AuthenticationError");
      expect(error.helpUrl).toBeTruthy();
      expect(error.helpUrl).toContain("http");
    });

    it("message is actionable", () => {
      const error = new AuthenticationError();
      expect(error.message).toContain("API key");
    });

    it("is instance of Error", () => {
      const error = new AuthenticationError();
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AuthenticationError);
    });
  });

  describe("ValidationError", () => {
    it("contains field name", () => {
      const error = new ValidationError("apiKey", "API key is required");
      expect(error.field).toBe("apiKey");
      expect(error.message).toContain("apiKey");
    });

    it("includes validation message", () => {
      const error = new ValidationError("model", "Invalid model name");
      expect(error.message).toContain("Invalid model name");
    });

    it("is instance of Error", () => {
      const error = new ValidationError("test", "test message");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ValidationError);
    });
  });

  describe("AgentError", () => {
    it("contains agent name", () => {
      const error = new AgentError("correctness", "Parsing failed");
      expect(error.agentName).toBe("correctness");
      expect(error.message).toContain("correctness");
    });

    it("includes error description", () => {
      const error = new AgentError("security", "Timeout occurred");
      expect(error.message).toContain("Timeout occurred");
    });

    it("is instance of Error", () => {
      const error = new AgentError("test", "test error");
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(AgentError);
    });
  });
});
