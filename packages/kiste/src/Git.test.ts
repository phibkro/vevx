import { describe, expect, test } from "bun:test";

import { parseGitLogOutput } from "./Git.js";

describe("parseGitLogOutput", () => {
  test("parses rename status lines", () => {
    const raw = [
      "---KISTE-COMMIT---",
      "abc123",
      "Author",
      "1700000000",
      "refactor: rename file",
      "",
      "---KISTE-FILES---",
      "R100\told/path.ts\tnew/path.ts",
    ].join("\n");

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].files).toEqual(["new/path.ts"]);
    expect(commits[0].deletedFiles).toEqual(["old/path.ts"]);
  });

  test("parses commit with body", () => {
    const raw = [
      "---KISTE-COMMIT---",
      "def456",
      "Author",
      "1700000000",
      "feat: add feature",
      "This is the body.",
      "Second body line.",
      "",
      "---KISTE-FILES---",
      "A\tsrc/new.ts",
    ].join("\n");

    const commits = parseGitLogOutput(raw);
    expect(commits).toHaveLength(1);
    expect(commits[0].subject).toBe("feat: add feature");
    expect(commits[0].body).toBe("This is the body.\nSecond body line.");
    expect(commits[0].files).toEqual(["src/new.ts"]);
  });

  test("returns empty array for empty input", () => {
    expect(parseGitLogOutput("")).toEqual([]);
    expect(parseGitLogOutput("   ")).toEqual([]);
  });
});
