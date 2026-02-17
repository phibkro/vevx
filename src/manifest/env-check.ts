import type { EnvCheckResult, Manifest } from "../types.js";

/**
 * Check environment variables required by a set of components.
 * Pure function — inject process.env for testability.
 */
export function checkEnv(
  manifest: Manifest,
  components: string[],
  env: Record<string, string | undefined>,
): EnvCheckResult {
  const required = [
    ...new Set(components.flatMap((name) => manifest.components[name]?.env ?? [])),
  ].sort();
  const set = required.filter((v) => env[v] !== undefined);
  const missing = required.filter((v) => env[v] === undefined);
  return { required, set, missing };
}
