import { describe, expect, test } from "bun:test";

import { errorMessage } from "./Mcp.js";

// ── errorMessage unit tests (no LSP needed) ──

describe("errorMessage", () => {
  test("extracts _tag + path from FiberFailure with TaggedError", () => {
    const sym = Symbol.for("effect/Runtime/FiberFailure/Cause");
    const err = Object.assign(new Error("An error has occurred"), {
      [sym]: {
        _tag: "Fail",
        error: { _tag: "FileNotFoundError", path: "/tmp/missing.ts" },
      },
    });
    expect(errorMessage(err)).toBe("FileNotFoundError: /tmp/missing.ts");
  });

  test("extracts _tag + message from FiberFailure when no path field", () => {
    const sym = Symbol.for("effect/Runtime/FiberFailure/Cause");
    const err = Object.assign(new Error("An error has occurred"), {
      [sym]: {
        _tag: "Fail",
        error: { _tag: "LspError", message: "connection refused" },
      },
    });
    expect(errorMessage(err)).toBe("LspError: connection refused");
  });

  test("returns just _tag when message is the default", () => {
    const sym = Symbol.for("effect/Runtime/FiberFailure/Cause");
    const err = Object.assign(new Error("An error has occurred"), {
      [sym]: {
        _tag: "Fail",
        error: { _tag: "LspTimeoutError", message: "An error has occurred" },
      },
    });
    expect(errorMessage(err)).toBe("LspTimeoutError");
  });

  test("falls back to Error.message for plain errors", () => {
    expect(errorMessage(new Error("something broke"))).toBe("something broke");
  });

  test("falls back to String() for non-objects", () => {
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });
});
