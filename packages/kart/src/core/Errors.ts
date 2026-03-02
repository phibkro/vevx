import { Data } from "effect";

export class LspError extends Data.TaggedError("LspError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class LspTimeoutError extends Data.TaggedError("LspTimeoutError")<{
  readonly request: string;
  readonly timeoutMs: number;
}> {}

export class FileNotFoundError extends Data.TaggedError("FileNotFoundError")<{
  readonly path: string;
}> {}
