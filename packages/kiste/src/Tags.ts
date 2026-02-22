/**
 * Pure functions for tag derivation and parsing.
 * No Effect dependency — these are synchronous and infallible.
 */

export interface TagConfig {
  readonly strip_prefixes: readonly string[];
  readonly stop_tags: readonly string[];
}

export interface TagOp {
  readonly tag: string;
  readonly op: "add" | "remove";
}

export interface ConventionalCommit {
  readonly type: string;
  readonly scope: string | null;
}

/**
 * Derive tags from a file path by:
 * 1. Splitting into segments
 * 2. Dropping the filename (last segment)
 * 3. Stripping leading segments that match strip_prefixes
 * 4. Filtering out stop_tags
 */
export function deriveTagsFromPath(filePath: string, config: TagConfig): string[] {
  const segments = filePath.split("/");

  // Drop filename (last segment)
  const dirs = segments.slice(0, -1);

  // Strip leading prefixes
  let startIndex = 0;
  while (startIndex < dirs.length && config.strip_prefixes.includes(dirs[startIndex])) {
    startIndex++;
  }
  const stripped = dirs.slice(startIndex);

  // Filter stop tags
  return stripped.filter((s) => !config.stop_tags.includes(s));
}

const TAG_LINE_RE = /^tags:\s*(.+)$/im;

/**
 * Find a `tags:` line in a commit body and parse comma-separated tags.
 * Tags can be prefixed with `+` (add, default) or `-` (remove).
 */
export function parseTagLine(body: string): TagOp[] | null {
  const match = TAG_LINE_RE.exec(body);
  if (!match) return null;

  return match[1].split(",").map((raw) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("+")) {
      return { tag: trimmed.slice(1), op: "add" };
    }
    if (trimmed.startsWith("-")) {
      return { tag: trimmed.slice(1), op: "remove" };
    }
    return { tag: trimmed, op: "add" };
  });
}

const CONVENTIONAL_RE = /^(\w+)(?:\(([^)]+)\))?!?:\s/;

/**
 * Parse a conventional commit subject line into type and optional scope.
 */
export function parseConventionalCommit(subject: string): ConventionalCommit | null {
  const match = CONVENTIONAL_RE.exec(subject);
  if (!match) return null;
  return { type: match[1], scope: match[2] ?? null };
}

/**
 * Apply a sequence of tag operations (add/remove) to a set,
 * returning the new set.
 */
export function applyTagOperations(current: Set<string>, ops: readonly TagOp[]): Set<string> {
  const result = new Set(current);
  for (const { tag, op } of ops) {
    if (op === "add") {
      result.add(tag);
    } else {
      result.delete(tag);
    }
  }
  return result;
}
