/**
 * Library entry point for programmatic use.
 * Re-exports types and pure functions that don't depend on Bun runtime APIs.
 * Use "@varp/core/lib" to import these in non-MCP consumers (e.g. @varp/audit).
 *
 * NOTE: Uses relative paths instead of #shared alias so that external consumers
 * can resolve types without core's tsconfig paths.
 */

// Types
export { componentPaths } from "./shared/types.js";
export type { Manifest, Component, Stability } from "./shared/types.js";

// Ownership
export { findOwningComponent, buildComponentPaths } from "./shared/ownership.js";
export type { ComponentPathEntry } from "./shared/ownership.js";

// Dependency graph
export { invalidationCascade, validateDependencyGraph } from "./manifest/graph.js";
