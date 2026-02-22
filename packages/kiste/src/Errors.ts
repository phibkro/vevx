import { Data } from "effect";

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
}> {}

export class GitError extends Data.TaggedError("GitError")<{
  readonly command: string;
  readonly stderr: string;
  readonly exitCode?: number;
}> {}

export class IndexError extends Data.TaggedError("IndexError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class DbError extends Data.TaggedError("DbError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}
