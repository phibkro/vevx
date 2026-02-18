import { existsSync } from "fs";
import { resolve } from "path";

/**
 * ValidationError - thrown when input validation fails
 */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Validate input path and environment before running audit
 * @throws ValidationError if validation fails
 * @returns Normalized absolute path
 */
export function validateInput(path: string): string {
  // Validate API key
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new ValidationError("API key (ANTHROPIC_API_KEY) environment variable is required");
  }

  // Validate path exists
  const absolutePath = resolve(path);
  if (!existsSync(absolutePath)) {
    throw new ValidationError(`Path does not exist: ${absolutePath}`);
  }

  return absolutePath;
}
