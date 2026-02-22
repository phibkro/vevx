/**
 * Format errors with helpful, actionable messages
 */
export function formatError(error: Error): string {
  return `\nError: ${error.message || "An unknown error occurred"}\n`;
}
