import { describe, expect, test } from "bun:test";
import {
  applyTagOperations,
  deriveTagsFromPath,
  parseConventionalCommit,
  parseTagLine,
} from "./Tags.js";

const defaultConfig = {
  strip_prefixes: ["src", "lib", "components", "app", "pages"],
  stop_tags: ["index", "utils", "helpers", "types"],
};

describe("deriveTagsFromPath", () => {
  test("strips configured prefixes", () => {
    expect(deriveTagsFromPath("src/auth/session/handler.ts", defaultConfig)).toEqual(["auth", "session"]);
  });
  test("strips multiple leading prefixes", () => {
    expect(deriveTagsFromPath("src/lib/auth/handler.ts", defaultConfig)).toEqual(["auth"]);
  });
  test("filters stop tags", () => {
    expect(deriveTagsFromPath("src/utils.ts", defaultConfig)).toEqual([]);
    expect(deriveTagsFromPath("lib/helpers/format.ts", defaultConfig)).toEqual([]);
  });
  test("preserves non-prefix non-stop segments", () => {
    expect(deriveTagsFromPath("packages/core/manifest/parser.ts", defaultConfig)).toEqual([
      "packages",
      "core",
      "manifest",
    ]);
  });
  test("handles root-level files", () => {
    expect(deriveTagsFromPath("README.md", defaultConfig)).toEqual([]);
  });
  test("drops file extension from filename", () => {
    expect(deriveTagsFromPath("auth/handler.test.ts", defaultConfig)).toEqual(["auth"]);
  });
});

describe("parseTagLine", () => {
  test("parses bare tags", () => {
    expect(parseTagLine("some body text\n\ntags: auth, redis, session")).toEqual([
      { tag: "auth", op: "add" },
      { tag: "redis", op: "add" },
      { tag: "session", op: "add" },
    ]);
  });
  test("parses +/- operators", () => {
    expect(parseTagLine("tags: +session, -auth, redis")).toEqual([
      { tag: "session", op: "add" },
      { tag: "auth", op: "remove" },
      { tag: "redis", op: "add" },
    ]);
  });
  test("returns null when no tag line", () => {
    expect(parseTagLine("just a normal commit body")).toBeNull();
  });
  test("finds tags: line anywhere in body", () => {
    expect(parseTagLine("line one\ntags: foo\nline three")).toEqual([{ tag: "foo", op: "add" }]);
  });
});

describe("parseConventionalCommit", () => {
  test("parses type and scope", () => {
    expect(parseConventionalCommit("feat(auth): add login")).toEqual({ type: "feat", scope: "auth" });
  });
  test("parses type without scope", () => {
    expect(parseConventionalCommit("fix: correct typo")).toEqual({ type: "fix", scope: null });
  });
  test("returns null for non-conventional", () => {
    expect(parseConventionalCommit("Update readme")).toBeNull();
  });
  test("handles breaking change indicator", () => {
    expect(parseConventionalCommit("feat(api)!: remove endpoint")).toEqual({
      type: "feat",
      scope: "api",
    });
  });
});

describe("applyTagOperations", () => {
  test("adds tags", () => {
    expect(applyTagOperations(new Set(), [{ tag: "auth", op: "add" as const }])).toEqual(
      new Set(["auth"]),
    );
  });
  test("removes tags", () => {
    expect(
      applyTagOperations(new Set(["auth", "redis"]), [{ tag: "auth", op: "remove" as const }]),
    ).toEqual(new Set(["redis"]));
  });
  test("removing non-existent tag is no-op", () => {
    expect(
      applyTagOperations(new Set(["auth"]), [{ tag: "nonexistent", op: "remove" as const }]),
    ).toEqual(new Set(["auth"]));
  });
  test("replays sequence correctly", () => {
    expect(
      applyTagOperations(new Set(), [
        { tag: "auth", op: "add" as const },
        { tag: "redis", op: "add" as const },
        { tag: "auth", op: "remove" as const },
        { tag: "session", op: "add" as const },
      ]),
    ).toEqual(new Set(["redis", "session"]));
  });
});
