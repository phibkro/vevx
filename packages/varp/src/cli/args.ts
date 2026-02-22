/** Default manifest path used across subcommands. */
export const DEFAULT_MANIFEST = "./varp.yaml";

/** Validate a string against allowed enum values. Throws with helpful message. */
export function parseEnum<T extends string>(value: string, valid: readonly T[], name: string): T {
  if (valid.includes(value as T)) return value as T;
  throw new Error(`Invalid ${name}: ${value}. Must be ${valid.join(" or ")}`);
}

/** Extract an optional flag value (for flags like --diff that default when no arg follows). */
export function consumeOptionalFlag(
  argv: string[],
  i: number,
  defaultValue: string,
): [value: string, newIndex: number] {
  const next = argv[i + 1];
  if (next && !next.startsWith("-")) {
    return [next, i + 1];
  }
  return [defaultValue, i];
}
