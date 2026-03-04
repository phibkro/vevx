/**
 * DeclCache — manages `.kart/decls/` cache via `tsc --declaration`.
 *
 * Generates `.d.ts` files for a TypeScript project using incremental
 * compilation, with staleness detection via a `.built` timestamp marker.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

// ── Types ──

export type BuildResult = {
  readonly success: boolean;
  readonly durationMs: number;
  readonly error?: string;
};

// ── Constants ──

const DECLS_DIR = ".kart/decls";
const BUILT_MARKER = ".built";
const TSCONFIG_NAME = "tsconfig.decl.json";

// ── Public API ──

/**
 * Runs `tsc --declaration --emitDeclarationOnly --incremental` into `.kart/decls/`.
 * Generates a tsconfig.decl.json in the decls directory and creates a `.built`
 * timestamp marker on success.
 */
export async function buildDeclarations(rootDir: string): Promise<BuildResult> {
  const absRoot = resolve(rootDir);
  const declsDir = join(absRoot, DECLS_DIR);

  mkdirSync(declsDir, { recursive: true });

  // Write tsconfig.decl.json
  const tsconfigPath = join(declsDir, TSCONFIG_NAME);
  const tsconfig = {
    compilerOptions: {
      target: "ES2022",
      module: "ESNext",
      moduleResolution: "bundler",
      strict: true,
      declaration: true,
      emitDeclarationOnly: true,
      declarationDir: declsDir,
      rootDir: absRoot,
      incremental: true,
      tsBuildInfoFile: join(declsDir, "tsconfig.tsbuildinfo"),
      skipLibCheck: true,
    },
    include: [join(absRoot, "**/*.ts"), join(absRoot, "**/*.tsx")],
    exclude: [
      join(absRoot, "node_modules"),
      join(absRoot, ".kart"),
      join(absRoot, "**/*.test.ts"),
      join(absRoot, "**/*.integration.test.ts"),
    ],
  };
  writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), "utf-8");

  // Find tsc binary
  const tscBin = findTsc(absRoot);

  const start = performance.now();

  try {
    const proc = Bun.spawn([tscBin, "--project", tsconfigPath], {
      cwd: absRoot,
      stdout: "pipe",
      stderr: "pipe",
    });

    const exitCode = await proc.exited;
    const durationMs = Math.round(performance.now() - start);

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      const stdout = await new Response(proc.stdout).text();
      const output = (stderr + stdout).trim();
      return { success: false, durationMs, error: output || `tsc exited with code ${exitCode}` };
    }

    // Write .built marker
    writeFileSync(join(declsDir, BUILT_MARKER), new Date().toISOString(), "utf-8");

    return { success: true, durationMs };
  } catch (err) {
    const durationMs = Math.round(performance.now() - start);
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, durationMs, error: message };
  }
}

/**
 * Compares `.kart/decls/.built` timestamp against newest source file mtime.
 * Returns true if any `.ts` source file is newer than the `.built` marker.
 */
export function isCacheStale(rootDir: string): boolean {
  const absRoot = resolve(rootDir);
  const builtPath = join(absRoot, DECLS_DIR, BUILT_MARKER);

  if (!existsSync(builtPath)) return true;

  const builtMtime = statSync(builtPath).mtimeMs;
  const newestSource = findNewestSourceMtime(absRoot);

  return newestSource > builtMtime;
}

/**
 * Reads the cached `.d.ts` for a source file.
 * Maps source path to `.kart/decls/<relative>.d.ts`.
 * Returns null if not cached.
 */
export function readDeclaration(rootDir: string, sourcePath: string): string | null {
  const absRoot = resolve(rootDir);
  const absSource = isAbsolute(sourcePath) ? sourcePath : join(absRoot, sourcePath);
  const rel = relative(absRoot, absSource);
  const dtsPath = join(absRoot, DECLS_DIR, rel.replace(/\.tsx?$/, ".d.ts"));

  if (!existsSync(dtsPath)) return null;

  return readFileSync(dtsPath, "utf-8");
}

// ── Internals ──

/**
 * Locate tsc binary by walking up node_modules/.bin from rootDir,
 * then from this module's own location, then falling back to PATH.
 */
function findTsc(fromDir: string): string {
  for (const startDir of [fromDir, import.meta.dir]) {
    let dir = resolve(startDir);
    while (true) {
      const candidate = join(dir, "node_modules", ".bin", "tsc");
      if (existsSync(candidate)) return candidate;

      const parent = resolve(dir, "..");
      if (parent === dir) break;
      dir = parent;
    }
  }

  // Fallback: assume tsc is on PATH
  return "tsc";
}

/**
 * Recursively find the newest `.ts` source file mtime, excluding
 * node_modules, .kart, test files.
 */
function findNewestSourceMtime(dir: string): number {
  let newest = 0;

  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return newest;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".kart") continue;
      const sub = findNewestSourceMtime(fullPath);
      if (sub > newest) newest = sub;
    } else if (
      entry.isFile() &&
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".test.ts") &&
      !entry.name.endsWith(".test.tsx") &&
      !entry.name.endsWith(".integration.test.ts") &&
      !entry.name.endsWith(".d.ts")
    ) {
      const mtime = statSync(fullPath).mtimeMs;
      if (mtime > newest) newest = mtime;
    }
  }

  return newest;
}
