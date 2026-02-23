/**
 * Latency spike for call hierarchy BFS — measures whether live traversal
 * is viable for kart_impact. See docs/plans/2026-02-22-kart-next-phases.md phase 1.
 *
 * Runs against the kart codebase itself (~18 files).
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { Effect, ManagedRuntime } from "effect";

import { LspClient, LspClientLive } from "./Lsp.js";
import type { CallHierarchyItem } from "./pure/types.js";

const hasLsp = Bun.which("typescript-language-server") !== null && !process.env.TURBO_HASH;

// Use kart's own source as the test codebase
const rootDir = resolve(import.meta.dir, "..");

describe.skipIf(!hasLsp)("call hierarchy latency spike", () => {
  let runtime: ManagedRuntime.ManagedRuntime<LspClient, never>;

  // Share one runtime across all tests in this describe
  test("setup", async () => {
    runtime = ManagedRuntime.make(LspClientLive({ rootDir }));
    await runtime.runPromise(Effect.void);
  }, 30_000);

  // Symbols to test: [uri, line, character, expectedName]
  // These are functions/methods at varying depths in the call graph
  // Line numbers are 0-indexed (LSP convention), char = start of function name
  const targets: Array<{ file: string; line: number; char: number; name: string }> = [
    // Pure utility — called from Symbols.ts toZoomSymbol
    { file: "src/pure/Signatures.ts", line: 44, char: 16, name: "extractSignature" },
    // Pure utility — called from Symbols.ts toZoomSymbol
    { file: "src/pure/ExportDetection.ts", line: 37, char: 16, name: "isExported" },
    // Pure utility — called from Symbols.ts toZoomSymbol
    { file: "src/pure/Signatures.ts", line: 115, char: 16, name: "extractDocComment" },
    // Pure utility — called from Symbols.ts toZoomSymbol
    { file: "src/pure/Signatures.ts", line: 33, char: 16, name: "symbolKindName" },
  ];

  /** BFS over incomingCalls up to maxDepth */
  async function bfs(
    item: CallHierarchyItem,
    maxDepth: number,
  ): Promise<{ totalCalls: number; totalTime: number; maxFanOut: number; visited: number }> {
    let totalCalls = 0;
    let totalTime = 0;
    let maxFanOut = 0;
    const visited = new Set<string>();
    const queue: Array<{ item: CallHierarchyItem; depth: number }> = [{ item, depth: 0 }];

    while (queue.length > 0) {
      const { item: current, depth } = queue.shift()!;
      if (depth >= maxDepth) continue;

      const key = `${current.uri}:${current.selectionRange.start.line}:${current.selectionRange.start.character}`;
      if (visited.has(key)) continue;
      visited.add(key);

      const start = performance.now();
      const calls = await runtime.runPromise(
        Effect.gen(function* () {
          const lsp = yield* LspClient;
          return yield* lsp.incomingCalls(current);
        }),
      );
      totalTime += performance.now() - start;
      totalCalls++;
      maxFanOut = Math.max(maxFanOut, calls.length);

      for (const call of calls) {
        queue.push({ item: call.from, depth: depth + 1 });
      }
    }

    return { totalCalls, totalTime, maxFanOut, visited: visited.size };
  }

  for (const target of targets) {
    test(`${target.name}: latency at depth 1/2/3`, async () => {
      const uri = `file://${resolve(rootDir, target.file)}`;

      // Prepare call hierarchy
      const items = await runtime.runPromise(
        Effect.gen(function* () {
          const lsp = yield* LspClient;
          return yield* lsp.prepareCallHierarchy(uri, target.line, target.char);
        }),
      );

      expect(items.length).toBeGreaterThan(0);
      const item = items[0];
      expect(item.name).toBe(target.name);

      // BFS at depths 1, 2, 3
      const results: Record<string, unknown>[] = [];
      for (const depth of [1, 2, 3]) {
        const r = await bfs(item, depth);
        results.push({
          depth,
          ...r,
          avgMs: r.totalCalls > 0 ? (r.totalTime / r.totalCalls).toFixed(1) : "N/A",
          totalMs: r.totalTime.toFixed(1),
        });
      }

      console.log(`\n--- ${target.name} (${target.file}) ---`);
      console.table(results);

      // Verify it completes in reasonable time
      const depth3 = results[2];
      expect(Number(depth3.totalMs)).toBeLessThan(10_000); // 10s max for depth 3
    }, 60_000);
  }

  test("teardown", async () => {
    if (runtime) await runtime.dispose();
  }, 15_000);
});

// ── Varp codebase spike (~50 files) ──

const varpRootDir = resolve(import.meta.dir, "../../varp");

describe.skipIf(!hasLsp)("call hierarchy latency spike (varp codebase)", () => {
  let runtime: ManagedRuntime.ManagedRuntime<LspClient, never>;

  test("setup", async () => {
    runtime = ManagedRuntime.make(LspClientLive({ rootDir: varpRootDir }));
    await runtime.runPromise(Effect.void);
  }, 30_000);

  // Dynamically find symbols — we'll use grep results
  test("discover symbols and measure latency", async () => {
    // parseManifest is heavily used across varp
    // Find its position dynamically via documentSymbol
    const manifestUri = `file://${resolve(varpRootDir, "src/manifest/parser.ts")}`;

    const symbols = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.documentSymbol(manifestUri);
      }),
    );

    const parseManifest = symbols.find((s) => s.name === "parseManifest");
    if (!parseManifest) {
      console.log("parseManifest not found, skipping varp latency spike");
      return;
    }

    // Get call hierarchy item
    const items = await runtime.runPromise(
      Effect.gen(function* () {
        const lsp = yield* LspClient;
        return yield* lsp.prepareCallHierarchy(
          manifestUri,
          parseManifest.selectionRange.start.line,
          parseManifest.selectionRange.start.character,
        );
      }),
    );

    expect(items.length).toBeGreaterThan(0);

    // BFS at depth 1, 2, 3
    const results: Record<string, unknown>[] = [];
    for (const depth of [1, 2, 3]) {
      let totalCalls = 0;
      let totalTime = 0;
      let maxFanOut = 0;
      const visited = new Set<string>();
      const queue: Array<{ item: CallHierarchyItem; depth: number }> = [
        { item: items[0], depth: 0 },
      ];

      while (queue.length > 0) {
        const { item: current, depth: d } = queue.shift()!;
        if (d >= depth) continue;
        const key = `${current.uri}:${current.selectionRange.start.line}`;
        if (visited.has(key)) continue;
        visited.add(key);

        const start = performance.now();
        const calls = await runtime.runPromise(
          Effect.gen(function* () {
            const lsp = yield* LspClient;
            return yield* lsp.incomingCalls(current);
          }),
        );
        totalTime += performance.now() - start;
        totalCalls++;
        maxFanOut = Math.max(maxFanOut, calls.length);
        for (const call of calls) queue.push({ item: call.from, depth: d + 1 });
      }

      results.push({
        depth,
        totalCalls,
        totalTime: totalTime.toFixed(1),
        maxFanOut,
        visited: visited.size,
        avgMs: totalCalls > 0 ? (totalTime / totalCalls).toFixed(1) : "N/A",
      });
    }

    console.log(`\n--- parseManifest (varp codebase, ~50 files) ---`);
    console.table(results);

    // Should complete in reasonable time
    expect(Number(results[2].totalTime)).toBeLessThan(10_000);
  }, 60_000);

  test("teardown", async () => {
    if (runtime) await runtime.dispose();
  }, 15_000);
});
