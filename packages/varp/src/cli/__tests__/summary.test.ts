import { describe, expect, it } from "bun:test";

import { parseSummaryArgs } from "../summary.js";

describe("parseSummaryArgs", () => {
  it("throws on invalid --format value", () => {
    expect(() => parseSummaryArgs(["--format", "xml"])).toThrow(/Invalid format/);
  });
});
