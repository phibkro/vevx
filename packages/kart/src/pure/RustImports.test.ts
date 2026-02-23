import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";

import type Parser from "web-tree-sitter";

import { extractRustFileImports, rustResolve } from "./RustImports.js";
import { initRustParser } from "./RustSymbols.js";

mkdirSync("/tmp/claude", { recursive: true });

// ── Parser setup ──

let parser: Parser;

beforeAll(async () => {
  const { resolve } = await import("node:path");
  const TreeSitter = (await import("web-tree-sitter")).default;
  await TreeSitter.init();

  const wasmPath = resolve(
    import.meta.dir,
    "../../node_modules/tree-sitter-wasms/out/tree-sitter-rust.wasm",
  );
  const lang = await TreeSitter.Language.load(wasmPath);
  const p = new TreeSitter();
  p.setLanguage(lang);
  parser = p;

  // Also init the RustSymbols parser (extractRustFileImports uses parseRustSymbols internally)
  await initRustParser();
});

// ── Extraction tests ──

describe("extractRustFileImports", () => {
  test("simple use statement", () => {
    const source = `use std::collections::HashMap;\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].specifier).toBe("std::collections::HashMap");
    expect(result.imports[0].importedNames).toEqual(["HashMap"]);
    expect(result.imports[0].isReExport).toBe(false);
  });

  test("grouped imports", () => {
    const source = `use std::{io, fs};\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(2);
    const specifiers = result.imports.map((i) => i.specifier).sort();
    expect(specifiers).toEqual(["std::fs", "std::io"]);
  });

  test("nested grouped imports", () => {
    const source = `use std::collections::{HashMap, BTreeMap};\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(2);
    const names = result.imports.flatMap((i) => i.importedNames).sort();
    expect(names).toEqual(["BTreeMap", "HashMap"]);
  });

  test("alias import", () => {
    const source = `use std::collections::HashMap as Map;\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].importedNames).toEqual(["Map"]);
  });

  test("glob import", () => {
    const source = `use std::io::prelude::*;\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].importedNames).toEqual([]);
  });

  test("pub use is marked as re-export", () => {
    const source = `pub use crate::models::User;\n\nfn helper() {}\n`;
    const result = extractRustFileImports(source, "lib.rs", parser);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].isReExport).toBe(true);
  });

  test("barrel detection: all pub use, no local items", () => {
    const source = `pub use crate::models::User;\npub use crate::models::Admin;\n`;
    const result = extractRustFileImports(source, "lib.rs", parser);

    expect(result.isBarrel).toBe(true);
  });

  test("not barrel when local declarations exist", () => {
    const source = `pub use crate::models::User;\n\npub fn helper() {}\n`;
    const result = extractRustFileImports(source, "lib.rs", parser);

    expect(result.isBarrel).toBe(false);
  });

  test("exported names from pub items", () => {
    const source = `pub fn greet() {}\nfn internal() {}\npub struct Config {}\n`;
    const result = extractRustFileImports(source, "lib.rs", parser);

    expect(result.exportedNames).toContain("greet");
    expect(result.exportedNames).toContain("Config");
    expect(result.exportedNames).not.toContain("internal");
  });

  test("empty source returns empty result", () => {
    const result = extractRustFileImports("", "lib.rs", parser);
    expect(result.imports).toEqual([]);
    expect(result.exportedNames).toEqual([]);
    expect(result.isBarrel).toBe(false);
  });

  test("crate-relative import", () => {
    const source = `use crate::models::User;\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].specifier).toBe("crate::models::User");
  });

  test("self-relative import", () => {
    const source = `use self::helper::process;\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].specifier).toBe("self::helper::process");
  });

  test("super-relative import", () => {
    const source = `use super::utils::format;\n\nfn main() {}\n`;
    const result = extractRustFileImports(source, "main.rs", parser);

    expect(result.imports).toHaveLength(1);
    expect(result.imports[0].specifier).toBe("super::utils::format");
  });
});

// ── Path resolution tests ──

describe("rustResolve", () => {
  let tempDir: string;

  beforeAll(() => {
    tempDir = realpathSync(mkdtempSync(join("/tmp/claude/", "kart-rust-resolve-")));
    // Create a mini crate structure
    mkdirSync(join(tempDir, "src", "models"), { recursive: true });
    writeFileSync(join(tempDir, "src", "models", "user.rs"), "pub struct User {}\n");
    writeFileSync(join(tempDir, "src", "models", "mod.rs"), "pub mod user;\n");
    writeFileSync(join(tempDir, "src", "lib.rs"), "mod models;\n");
    writeFileSync(join(tempDir, "src", "utils.rs"), "pub fn format() {}\n");
    writeFileSync(join(tempDir, "Cargo.toml"), '[package]\nname = "test"\n');
  });

  test("crate:: resolves to src/ file", () => {
    const result = rustResolve("crate::utils::format", join(tempDir, "src"), tempDir);
    expect(result).toBe(join(tempDir, "src", "utils.rs"));
  });

  test("crate:: resolves to mod.rs for directories", () => {
    const result = rustResolve("crate::models", join(tempDir, "src"), tempDir);
    expect(result).toBe(join(tempDir, "src", "models", "mod.rs"));
  });

  test("crate:: resolves nested module item to module file", () => {
    const result = rustResolve("crate::models::user::User", join(tempDir, "src"), tempDir);
    expect(result).toBe(join(tempDir, "src", "models", "user.rs"));
  });

  test("self:: resolves relative to current directory", () => {
    const result = rustResolve("self::utils::format", join(tempDir, "src"), tempDir);
    expect(result).toBe(join(tempDir, "src", "utils.rs"));
  });

  test("super:: resolves to parent directory", () => {
    const result = rustResolve("super::utils::format", join(tempDir, "src", "models"), tempDir);
    expect(result).toBe(join(tempDir, "src", "utils.rs"));
  });

  test("external crate returns null", () => {
    const result = rustResolve("serde::Serialize", join(tempDir, "src"), tempDir);
    expect(result).toBeNull();
  });

  test("nonexistent path returns null", () => {
    const result = rustResolve("crate::nonexistent::Foo", join(tempDir, "src"), tempDir);
    expect(result).toBeNull();
  });

  test("crate:: without crateRoot returns null", () => {
    const result = rustResolve("crate::foo", join(tempDir, "src"));
    expect(result).toBeNull();
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });
});
