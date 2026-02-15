import Anthropic from "@anthropic-ai/sdk";

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000; // 1 second

export interface ApiCallOptions {
  model: string;
  maxTokens?: number;
}

/**
 * Initialize Anthropic client with API key from environment
 */
function createClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY environment variable is not set.\n" +
        "Please set it with: export ANTHROPIC_API_KEY='your-api-key'"
    );
  }

  return new Anthropic({
    apiKey,
  });
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Call Claude API with retry logic and rate limiting
 */
export async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  options: ApiCallOptions
): Promise<string> {
  const client = createClient();
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await client.messages.create({
        model: options.model,
        max_tokens: options.maxTokens || 4096,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: userPrompt,
          },
        ],
      });

      // Extract text from response
      const textContent = response.content.find((block) => block.type === "text");
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text content in API response");
      }

      return textContent.text;
    } catch (error) {
      lastError = error as Error;

      // Check if it's a rate limit error (429)
      if (error instanceof Anthropic.APIError) {
        if (error.status === 429) {
          const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
          console.warn(
            `Rate limit hit (429). Retrying in ${retryDelay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`
          );
          await sleep(retryDelay);
          continue;
        }

        // For other API errors, provide detailed message
        if (error.status === 401) {
          throw new Error(
            `Invalid Anthropic API key (401 Unauthorized)\n\n` +
            `Your ANTHROPIC_API_KEY is invalid or expired.\n` +
            `Get a new key at: https://console.anthropic.com/settings/keys\n` +
            `Then set it with: export ANTHROPIC_API_KEY='your-new-key'`
          );
        }

        if (error.status === 429) {
          throw new Error(
            `Rate limit exceeded (429)\n\n` +
            `You've hit the API rate limit or quota.\n` +
            `Check your usage at: https://console.anthropic.com/settings/usage\n` +
            `Consider upgrading your plan for higher limits.`
          );
        }

        // Generic API error
        throw new Error(
          `Anthropic API error (${error.status}): ${error.message}\n` +
          `Check the API status: https://status.anthropic.com/`
        );
      }

      // For network errors, provide helpful message
      if (lastError.message.includes("fetch") || lastError.message.includes("network")) {
        throw new Error(
          `Network error: Cannot reach Anthropic API\n\n` +
          `Please check:\n` +
          `  1. Your internet connection\n` +
          `  2. Firewall or proxy settings\n` +
          `  3. API status: https://status.anthropic.com/`
        );
      }

      // For other errors, retry with exponential backoff
      if (attempt < MAX_RETRIES - 1) {
        const retryDelay = INITIAL_RETRY_DELAY * Math.pow(2, attempt);
        console.warn(
          `API call failed: ${lastError.message}. Retrying in ${retryDelay / 1000}s... (attempt ${attempt + 1}/${MAX_RETRIES})`
        );
        await sleep(retryDelay);
      }
    }
  }

  // All retries exhausted
  throw new Error(
    `API call failed after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || "Unknown error"}`
  );
}

/**
 * Simple test function to verify API connectivity
 * Can be run with: bun run src/client.ts
 */
export async function testConnection(model: string = "claude-sonnet-4-5-20250929"): Promise<void> {
  console.log("Testing Anthropic API connection...");

  try {
    const response = await callClaude(
      "You are a helpful assistant. Respond concisely.",
      "Say 'API connection successful' and nothing else.",
      { model, maxTokens: 100 }
    );

    console.log("✓ Success!");
    console.log("Response:", response);
  } catch (error) {
    console.error("✗ Test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Allow running this file directly for testing
if (import.meta.main) {
  testConnection();
}
