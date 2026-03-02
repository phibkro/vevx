import { extname } from "node:path";

import { Context, Data, Effect, Layer, ManagedRuntime } from "effect";

import { LspClientLive } from "./Lsp.js";
import { type AstPlugin, type LspPlugin, makeRegistry, PluginRegistry, PluginUnavailableError } from "./Plugin.js";
import { SymbolIndex, SymbolIndexLive } from "./Symbols.js";

// ── Registry construction ──

export const makeRegistryFromPlugins = (plugins: {
  ast: AstPlugin["Type"][];
  lsp: LspPlugin["Type"][];
}): PluginRegistry["Type"] => makeRegistry(plugins.ast, plugins.lsp);

// ── LspRuntimes ──

export class LspRuntimes extends Context.Tag("kart/LspRuntimes")<
  LspRuntimes,
  {
    readonly runtimeFor: (
      path: string,
    ) => Effect.Effect<ManagedRuntime.ManagedRuntime<SymbolIndex, never>, PluginUnavailableError>;
    readonly disposeAll: () => Promise<void>;
    readonly recreate: (ext?: string) => void;
  }
>() {}

/**
 * Create LspRuntimes that lazily spawns per-language ManagedRuntimes.
 * Each unique file extension maps to one LspPlugin, one runtime.
 */
export function makeLspRuntimes(
  registry: PluginRegistry["Type"],
  rootDir: string,
): LspRuntimes["Type"] {
  const runtimes = new Map<string, ManagedRuntime.ManagedRuntime<SymbolIndex, never>>();

  const buildRuntime = (plugin: LspPlugin["Type"]) =>
    ManagedRuntime.make(
      SymbolIndexLive({ rootDir }).pipe(
        Layer.provide(LspClientLive({ rootDir, plugin })),
      ),
    );

  return {
    runtimeFor: (path) =>
      Effect.gen(function* () {
        const ext = extname(path);
        const existing = runtimes.get(ext);
        if (existing) return existing;

        const plugin = registry.lspFor(path);
        if (plugin._tag === "None") {
          return yield* Effect.fail(new PluginUnavailableError({ path, capability: "lsp" }));
        }

        const runtime = buildRuntime(plugin.value);
        runtimes.set(ext, runtime);
        return runtime;
      }),

    disposeAll: async () => {
      for (const rt of runtimes.values()) {
        await rt.dispose();
      }
      runtimes.clear();
    },

    recreate: (ext?: string) => {
      if (ext) {
        const old = runtimes.get(ext);
        if (old) {
          old.dispose().catch(() => {});
          runtimes.delete(ext);
        }
      } else {
        for (const rt of runtimes.values()) {
          rt.dispose().catch(() => {});
        }
        runtimes.clear();
      }
    },
  };
}
