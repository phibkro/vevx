import { describe, expect, test } from "bun:test";

import { extractDocComment, extractSignature } from "./Signatures.js";
import type { DocumentSymbol } from "./types.js";

// ── Pure function tests (no LSP needed) ──

describe("extractSignature", () => {
  const makeSymbol = (
    name: string,
    kind: number,
    startLine: number,
    startChar: number,
    endLine: number,
    endChar: number,
  ): DocumentSymbol => ({
    name,
    kind,
    range: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
    selectionRange: {
      start: { line: startLine, character: startChar },
      end: { line: endLine, character: endChar },
    },
  });

  test("extracts function signature up to opening brace", () => {
    const lines = [
      "export function greet(name: string): string {",
      "  return `Hello ${name}`;",
      "}",
    ];
    const sym = makeSymbol("greet", 12, 0, 0, 2, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export function greet(name: string): string");
  });

  test("extracts const declaration", () => {
    const lines = ["export const MAX_COUNT = 100;"];
    const sym = makeSymbol("MAX_COUNT", 13, 0, 0, 0, 28);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export const MAX_COUNT = 100;");
  });

  test("extracts type alias", () => {
    const lines = ["export type ID = string | number;"];
    const sym = makeSymbol("ID", 26, 0, 0, 0, 32);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export type ID = string | number;");
  });

  test("extracts class signature without body", () => {
    const lines = ["export class UserService {", "  constructor() {}", "}"];
    const sym = makeSymbol("UserService", 5, 0, 0, 2, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export class UserService");
  });

  test("handles multi-line function signature", () => {
    const lines = [
      "export function createUser(",
      "  name: string,",
      "  age: number,",
      "): User {",
      "  return { name, age };",
      "}",
    ];
    const sym = makeSymbol("createUser", 12, 0, 0, 5, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export function createUser(\n  name: string,\n  age: number,\n): User");
  });

  test("returns symbol name for out-of-range line", () => {
    const sym = makeSymbol("ghost", 12, 9999, 0, 9999, 0);
    const sig = extractSignature(sym, []);
    expect(sig).toBe("ghost");
  });

  test("handles interface with generic", () => {
    const lines = ["export interface Repository<T> {", "  findById(id: string): T;", "}"];
    const sym = makeSymbol("Repository", 11, 0, 0, 2, 1);
    const sig = extractSignature(sym, lines);
    expect(sig).toBe("export interface Repository<T>");
  });
});

describe("extractDocComment", () => {
  const makeSymbol = (startLine: number): DocumentSymbol => ({
    name: "test",
    kind: 12,
    range: { start: { line: startLine, character: 0 }, end: { line: startLine, character: 0 } },
    selectionRange: {
      start: { line: startLine, character: 0 },
      end: { line: startLine, character: 0 },
    },
  });

  test("extracts single-line JSDoc comment", () => {
    const lines = ["/** Greet a user by name. */", "export function greet(name: string): string {"];
    const result = extractDocComment(makeSymbol(1), lines);
    expect(result).toBe("/** Greet a user by name. */");
  });

  test("extracts multi-line JSDoc comment", () => {
    const lines = [
      "/**",
      " * Create a new user.",
      " * @param name - The user's name",
      " */",
      "export function createUser(name: string) {",
    ];
    const result = extractDocComment(makeSymbol(4), lines);
    expect(result).toBe("/**\n * Create a new user.\n * @param name - The user's name\n */");
  });

  test("returns null when no doc comment present", () => {
    const lines = ["const x = 1;", "export function greet() {"];
    const result = extractDocComment(makeSymbol(1), lines);
    expect(result).toBeNull();
  });

  test("returns null for regular comments (not JSDoc)", () => {
    const lines = ["// This is a regular comment", "export function greet() {"];
    const result = extractDocComment(makeSymbol(1), lines);
    expect(result).toBeNull();
  });

  test("skips blank lines between doc comment and symbol", () => {
    const lines = ["/** Documented. */", "", "export function greet() {"];
    const result = extractDocComment(makeSymbol(2), lines);
    expect(result).toBe("/** Documented. */");
  });
});
