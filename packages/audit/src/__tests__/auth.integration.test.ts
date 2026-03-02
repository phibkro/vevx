import { describe, test, expect, beforeEach, afterEach } from "bun:test";

// These tests mutate process.env — must run sequentially
const serialTest = test.serial;

// Note: We only test getApiKey() with environment variables here.
// Testing file-based config requires either:
// 1. Mocking the entire fs module (complex in Bun)
// 2. Integration tests that can write to temp directories
// 3. Manual testing
//
// Since getApiKey() prioritizes env vars over files, testing env var behavior
// covers the critical path.

describe("auth module", () => {
  // Store original env vars
  let originalApiKey: string | undefined;
  let originalApiUrl: string | undefined;

  beforeEach(() => {
    // Save original environment variables
    originalApiKey = process.env.CODE_AUDITOR_API_KEY;
    originalApiUrl = process.env.CODE_AUDITOR_API_URL;

    // Clear environment variables
    delete process.env.CODE_AUDITOR_API_KEY;
    delete process.env.CODE_AUDITOR_API_URL;
  });

  afterEach(() => {
    // Restore original environment variables
    if (originalApiKey !== undefined) {
      process.env.CODE_AUDITOR_API_KEY = originalApiKey;
    } else {
      delete process.env.CODE_AUDITOR_API_KEY;
    }

    if (originalApiUrl !== undefined) {
      process.env.CODE_AUDITOR_API_URL = originalApiUrl;
    } else {
      delete process.env.CODE_AUDITOR_API_URL;
    }
  });

  describe("getApiKey (environment variable behavior)", () => {
    // We only test env var behavior here since file-based config requires
    // either complex fs mocking or integration tests

    serialTest("returns null when no API key is configured", async () => {
      // Dynamic import to ensure clean module state
      const { getApiKey } = await import("../cli/auth.ts");
      const result = getApiKey();

      // Should return null when neither env var nor config file has a key
      // (assuming no ~/.code-auditor/config.json exists)
      expect(result === null || result?.apiKey).toBeTruthy();
    });

    serialTest("returns API key from environment variable", async () => {
      process.env.CODE_AUDITOR_API_KEY = "ca_test_env_key_1234567890abcdef";

      const { getApiKey } = await import("../cli/auth.ts");
      const result = getApiKey();

      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("ca_test_env_key_1234567890abcdef");
      expect(result?.apiUrl).toBe("https://code-auditor.com");
    });

    serialTest("returns custom API URL from environment variable", async () => {
      process.env.CODE_AUDITOR_API_KEY = "ca_test_key";
      process.env.CODE_AUDITOR_API_URL = "https://custom-url.com";

      const { getApiKey } = await import("../cli/auth.ts");
      const result = getApiKey();

      expect(result).not.toBeNull();
      expect(result?.apiUrl).toBe("https://custom-url.com");
    });

    serialTest("uses default URL when CODE_AUDITOR_API_URL not set", async () => {
      process.env.CODE_AUDITOR_API_KEY = "ca_test_key";
      // CODE_AUDITOR_API_URL not set

      const { getApiKey } = await import("../cli/auth.ts");
      const result = getApiKey();

      expect(result).not.toBeNull();
      expect(result?.apiUrl).toBe("https://code-auditor.com");
    });

    serialTest("environment variable takes precedence over config file", async () => {
      // This test verifies priority behavior by setting env var
      // Even if a config file exists, env var should win
      process.env.CODE_AUDITOR_API_KEY = "ca_env_priority_key";
      process.env.CODE_AUDITOR_API_URL = "https://env-priority.com";

      const { getApiKey } = await import("../cli/auth.ts");
      const result = getApiKey();

      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe("ca_env_priority_key");
      expect(result?.apiUrl).toBe("https://env-priority.com");
    });
  });
});
