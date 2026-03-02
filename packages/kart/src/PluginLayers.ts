import { Context, Effect, Layer, ManagedRuntime } from "effect";

import { LspClientLive } from "./Lsp.js";
import {
  type AstPlugin,
  type LspPlugin,
  makeRegistry,
  PluginRegistry,
  PluginUnavailableError,
} from "./Plugin.js";
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
    readonly allRuntimes: () => Effect.Effect<
      ManagedRuntime.ManagedRuntime<SymbolIndex, never>[],
      never
    >;
    readonly disposeAll: () => Promise<void>;
    readonly recreate: (path?: string) => void;
  }
>() {}

/**
 * Create LspRuntimes that lazily spawns per-language ManagedRuntimes.
 * Each unique file extension maps to one LspPlugin, one runtime.
 *
 * Accepts a registry getter so changes to the registry (e.g. async plugin
 * init) are reflected in subsequent calls without recreating the runtimes.
 */
export function makeLspRuntimes(
  getRegistry: () => PluginRegistry["Type"],
  rootDir: string,
): LspRuntimes["Type"] {
  const runtimes = new Map<string, ManagedRuntime.ManagedRuntime<SymbolIndex, never>>();

  const buildRuntime = (plugin: LspPlugin["Type"]) =>
    ManagedRuntime.make(
      SymbolIndexLive({ rootDir }).pipe(Layer.provide(LspClientLive({ rootDir, plugin }))),
    );

  const getOrCreate = (plugin: LspPlugin["Type"]) => {
    const key = plugin.binary;
    const existing = runtimes.get(key);
    if (existing) return existing;
    const runtime = buildRuntime(plugin);
    runtimes.set(key, runtime);
    return runtime;
  };

  return {
    runtimeFor: (path) =>
      Effect.gen(function* () {
        const plugin = getRegistry().lspFor(path);
        if (plugin._tag === "None") {
          return yield* Effect.fail(new PluginUnavailableError({ path, capability: "lsp" }));
        }
        return getOrCreate(plugin.value);
      }),

    allRuntimes: () =>
      Effect.sync(() =>
        getRegistry()
          .allLspPlugins()
          .map((plugin) => getOrCreate(plugin)),
      ),

    disposeAll: async () => {
      for (const rt of runtimes.values()) {
        await rt.dispose();
      }
      runtimes.clear();
    },

    recreate: (path?: string) => {
      if (path) {
        const plugin = getRegistry().lspFor(path);
        if (plugin._tag === "None") return;
        const key = plugin.value.binary;
        const old = runtimes.get(key);
        if (old) {
          old.dispose().catch(() => {});
          runtimes.delete(key);
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
