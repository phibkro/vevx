import { readFileSync } from "fs";
import { resolve } from "path";

export interface Config {
  model: string;
  maxTokensPerChunk: number;
  parallel: boolean;
  outputPath?: string;
}

interface ConfigFile {
  model?: string;
  maxTokensPerChunk?: number;
  parallel?: boolean;
}

const DEFAULT_CONFIG: Config = {
  model: "claude-sonnet-4-5-20250929",
  maxTokensPerChunk: 100000,
  parallel: true,
};

/**
 * Load configuration from .code-auditor.json if it exists, merge with defaults and CLI args
 */
export function loadConfig(cliArgs: Partial<Config> = {}): Config {
  let fileConfig: ConfigFile = {};

  try {
    const configPath = resolve(process.cwd(), ".code-auditor.json");
    const configContent = readFileSync(configPath, "utf-8");
    fileConfig = JSON.parse(configContent);
  } catch (error) {
    // Config file is optional, ignore if not found
    if (error instanceof Error && !error.message.includes("ENOENT")) {
      console.warn(`Warning: Failed to parse .code-auditor.json: ${error.message}`);
    }
  }

  // Merge: defaults → config file → CLI args
  // Filter out undefined values from cliArgs
  const filteredCliArgs = Object.fromEntries(
    Object.entries(cliArgs).filter(([_, v]) => v !== undefined)
  );

  return {
    ...DEFAULT_CONFIG,
    ...fileConfig,
    ...filteredCliArgs,
  };
}

/**
 * Validate configuration values
 */
export function validateConfig(config: Config): void {
  if (config.maxTokensPerChunk < 1000) {
    throw new Error("maxTokensPerChunk must be at least 1000");
  }

  if (!config.model || config.model.trim().length === 0) {
    throw new Error("model must be specified");
  }
}
