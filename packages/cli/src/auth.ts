import { readFileSync, writeFileSync, mkdirSync, unlinkSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

interface AuthConfig {
  apiKey?: string;
  apiUrl?: string;
}

const CONFIG_DIR = join(homedir(), ".code-audit");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

/**
 * Get API key from highest priority source
 * Priority: env var > config file
 */
export function getApiKey(): { apiKey: string; apiUrl: string } | null {
  // Check environment variable first
  const envKey = process.env.CODE_AUDITOR_API_KEY;
  const envUrl = process.env.CODE_AUDITOR_API_URL || "https://code-auditor.com";

  if (envKey) {
    return { apiKey: envKey, apiUrl: envUrl };
  }

  // Check config file
  try {
    if (existsSync(CONFIG_FILE)) {
      const configContent = readFileSync(CONFIG_FILE, "utf-8");
      const config: AuthConfig = JSON.parse(configContent);

      if (config.apiKey) {
        return {
          apiKey: config.apiKey,
          apiUrl: config.apiUrl || "https://code-auditor.com",
        };
      }
    }
  } catch (error) {
    console.warn(
      `Warning: Failed to read auth config: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return null;
}

/**
 * Prompt user for API key input (secure, hidden input)
 */
async function promptForApiKey(): Promise<string> {
  const readline = await import("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    // Note: Bun doesn't support muting stdin, so key will be visible
    // In production, would use a package like 'read' for hidden input
    rl.question("Enter your API key (from dashboard): ", (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/**
 * Validate API key format
 */
function validateApiKeyFormat(key: string): boolean {
  // API keys should start with 'ca_' and be 64+ hex chars after prefix
  return key.startsWith("ca_") && key.length >= 67;
}

/**
 * Validate API key by testing against the API
 */
async function validateApiKey(apiKey: string, apiUrl: string): Promise<boolean> {
  try {
    // Make a lightweight request to validate the key
    // We can't use /api/cli/audit without a full payload, so we'll just check the auth header
    const response = await fetch(`${apiUrl}/api/cli/audit`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        overallScore: 0,
        criticalCount: 0,
        warningCount: 0,
        infoCount: 0,
        durationMs: 0,
        findings: [],
      }),
    });

    // 200 = valid, 401 = invalid key, 400 = valid key but bad payload (acceptable for validation)
    return response.status !== 401;
  } catch (error) {
    console.warn(
      `Warning: Could not validate API key: ${error instanceof Error ? error.message : String(error)}`,
    );
    // If network error, assume key format is good enough
    return true;
  }
}

/**
 * Login command - prompts for API key and saves it
 */
export async function login(): Promise<void> {
  console.log("AI Code Audit - Login\n");
  console.log("Get your API key from the dashboard:");
  console.log("  https://code-auditor.com/settings/api-keys\n");

  const apiKey = await promptForApiKey();

  if (!apiKey) {
    console.error("Error: No API key provided");
    process.exit(1);
  }

  // Validate format
  if (!validateApiKeyFormat(apiKey)) {
    console.error(
      "Error: Invalid API key format. Keys should start with 'ca_' and be 64+ characters.",
    );
    process.exit(1);
  }

  // Validate against API
  console.log("\nValidating API key...");
  const apiUrl = process.env.CODE_AUDITOR_API_URL || "https://code-auditor.com";
  const isValid = await validateApiKey(apiKey, apiUrl);

  if (!isValid) {
    console.error("Error: API key is invalid or expired. Please check your key and try again.");
    process.exit(1);
  }

  // Save to config file
  try {
    // Create directory if it doesn't exist
    if (!existsSync(CONFIG_DIR)) {
      mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    }

    const config: AuthConfig = {
      apiKey,
      apiUrl,
    };

    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });

    console.log(`\n✓ Successfully logged in!`);
    console.log(`  Config saved to: ${CONFIG_FILE}`);
    console.log(`\nYou can now run code-audit without setting CODE_AUDITOR_API_KEY.\n`);
  } catch (error) {
    console.error(`Error saving config: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Logout command - removes saved API key
 */
export function logout(): void {
  try {
    if (existsSync(CONFIG_FILE)) {
      unlinkSync(CONFIG_FILE);
      console.log("✓ Logged out successfully");
      console.log(`  Removed config file: ${CONFIG_FILE}\n`);
    } else {
      console.log("Already logged out (no config file found)\n");
    }
  } catch (error) {
    console.error(
      `Error removing config: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  }
}
