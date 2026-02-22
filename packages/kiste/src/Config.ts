import { Context, Effect, Layer } from "effect";
import * as Schema from "effect/Schema";
import { ConfigError } from "./Errors.js";

export const ConfigSchema = Schema.Struct({
  strip_prefixes: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => ["src", "lib", "components", "app", "pages"],
  }),
  stop_tags: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => ["index", "utils", "helpers", "types"],
  }),
  snapshot_frequency: Schema.optionalWith(Schema.Number, {
    default: () => 500,
  }),
  exclude: Schema.optionalWith(Schema.Array(Schema.String), {
    default: () => ["node_modules/**", "dist/**", "*.lock"],
  }),
  db_path: Schema.optionalWith(Schema.String, {
    default: () => ".kiste/index.sqlite",
  }),
});

export type ConfigShape = Schema.Schema.Type<typeof ConfigSchema>;

export class Config extends Context.Tag("@kiste/Config")<Config, ConfigShape>() {}

export const ConfigLive = (repoDir: string): Layer.Layer<Config, ConfigError> =>
  Layer.effect(
    Config,
    Effect.gen(function* () {
      const configPath = `${repoDir}/.kiste.yaml`;
      const raw = yield* Effect.tryPromise({
        try: async () => {
          const file = Bun.file(configPath);
          const exists = await file.exists();
          if (!exists) return {};
          const text = await file.text();
          return Bun.YAML.parse(text) as Record<string, unknown>;
        },
        catch: (err) => new ConfigError({ message: `Failed to read config: ${err}` }),
      });
      return yield* Schema.decodeUnknown(ConfigSchema)(raw).pipe(
        Effect.mapError((err) => new ConfigError({ message: `Invalid config: ${err}` })),
      );
    }),
  );
