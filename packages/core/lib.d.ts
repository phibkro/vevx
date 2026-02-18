/**
 * Type declarations for @varp/core/lib.
 * Hand-maintained to avoid requiring consumers to resolve core's internal path aliases.
 */

// ── Types from shared/types.ts ──

export type Stability = "stable" | "active" | "experimental";

export type Component = {
  path: string | string[];
  deps?: string[];
  docs: string[];
  tags?: string[];
  test?: string;
  env?: string[];
  stability?: Stability;
};

export type Manifest = {
  varp: string;
  components: Record<string, Component>;
};

export function componentPaths(comp: Component): string[];

// ── Ownership from shared/ownership.ts ──

export type ComponentPathEntry = { name: string; path: string };

export function buildComponentPaths(manifest: Manifest): ComponentPathEntry[];
export function findOwningComponent(
  filePath: string,
  manifest: Manifest,
  componentPaths?: ComponentPathEntry[],
): string | null;

// ── Graph from manifest/graph.ts ──

export function invalidationCascade(manifest: Manifest, changed: string[]): string[];
export function validateDependencyGraph(
  manifest: Manifest,
): { valid: true } | { valid: false; cycles: string[] };
