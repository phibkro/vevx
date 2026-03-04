import { describe, expect, test } from "bun:test";

import { extractTypeReferences, resolveTypeOrigins } from "./TypeRefs.js";

describe("extractTypeReferences", () => {
  test("extracts param and return type references", () => {
    const dts = [
      'import type { Point } from "./math.js";',
      "export declare function distance(a: Point, b: Point): number;",
    ].join("\n");

    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Point");
    expect(refs).not.toContain("number");
  });

  test("extracts extends/implements references", () => {
    const dts = [
      'import type { Base } from "./base.js";',
      "export declare class Foo extends Base {",
      "  value: string;",
      "}",
    ].join("\n");

    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Base");
  });

  test("extracts property type references", () => {
    const dts = [
      'import type { Color } from "./color.js";',
      "export interface Shape {",
      "  color: Color;",
      "  size: number;",
      "}",
    ].join("\n");

    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Color");
    expect(refs).not.toContain("number");
  });

  test("deep mode includes generic type params", () => {
    const dts = [
      'import type { Schema } from "./schema.js";',
      "export declare function parse<T extends Schema>(input: string): T;",
    ].join("\n");

    const refs = extractTypeReferences(dts, true);
    expect(refs).toContain("Schema");
  });

  test("ignores built-in types", () => {
    const dts = "export declare function foo(a: string, b: number): void;";
    const refs = extractTypeReferences(dts, false);
    expect(refs).toEqual([]);
  });

  test("shallow mode only returns imported types referenced in signatures", () => {
    // Point is imported and referenced → included
    // Unused is imported but not referenced → excluded
    // Orphan appears in body but is not imported → excluded
    const dts = [
      'import type { Point } from "./math.js";',
      'import type { Unused } from "./unused.js";',
      "export declare function distance(a: Point): Orphan;",
    ].join("\n");

    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Point");
    expect(refs).not.toContain("Unused");
    expect(refs).not.toContain("Orphan");
  });

  test("deep mode includes non-imported type references", () => {
    const dts = [
      'import type { Schema } from "./schema.js";',
      "export declare function parse<T extends Schema>(input: string): Result<T>;",
    ].join("\n");

    const refs = extractTypeReferences(dts, true);
    expect(refs).toContain("Schema");
    expect(refs).toContain("Result");
  });

  test("handles union and intersection types", () => {
    const dts = [
      'import type { Foo } from "./foo.js";',
      'import type { Bar } from "./bar.js";',
      "export declare function merge(a: Foo | Bar): Foo & Bar;",
    ].join("\n");

    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Foo");
    expect(refs).toContain("Bar");
  });

  test("handles multiple imports from same source", () => {
    const dts = [
      'import type { Point, Vector } from "./math.js";',
      "export declare function transform(p: Point): Vector;",
    ].join("\n");

    const refs = extractTypeReferences(dts, false);
    expect(refs).toContain("Point");
    expect(refs).toContain("Vector");
  });

  test("returns deduplicated results", () => {
    const dts = [
      'import type { Point } from "./math.js";',
      "export declare function distance(a: Point, b: Point): Point;",
    ].join("\n");

    const refs = extractTypeReferences(dts, false);
    const pointCount = refs.filter((r) => r === "Point").length;
    expect(pointCount).toBe(1);
  });
});

describe("resolveTypeOrigins", () => {
  test("maps type names to import sources", () => {
    const dts = [
      'import type { Point } from "./math.js";',
      'import type { Color } from "./color.js";',
      "export declare function draw(p: Point, c: Color): void;",
    ].join("\n");

    const origins = resolveTypeOrigins(dts);
    expect(origins.get("Point")).toBe("./math.js");
    expect(origins.get("Color")).toBe("./color.js");
  });

  test("handles multiple imports from same source", () => {
    const dts = 'import type { Point, Vector } from "./math.js";';

    const origins = resolveTypeOrigins(dts);
    expect(origins.get("Point")).toBe("./math.js");
    expect(origins.get("Vector")).toBe("./math.js");
  });

  test("handles regular imports with type keyword", () => {
    const dts = 'import { type Foo, type Bar } from "./types.js";';

    const origins = resolveTypeOrigins(dts);
    expect(origins.get("Foo")).toBe("./types.js");
    expect(origins.get("Bar")).toBe("./types.js");
  });

  test("returns empty map for no imports", () => {
    const dts = "export declare function foo(): void;";
    const origins = resolveTypeOrigins(dts);
    expect(origins.size).toBe(0);
  });
});
