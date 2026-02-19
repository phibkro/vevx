import { describe, expect, it } from "bun:test";

import { formatError } from "../errors";

describe("formatError", () => {
  it("includes the error message", () => {
    const output = formatError(new Error("something went wrong"));
    expect(output).toContain("something went wrong");
  });

  it("handles errors without messages", () => {
    const output = formatError(new Error());
    expect(output).toContain("Error");
  });
});
