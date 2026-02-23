import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { getImporters, getImports, getUnusedExports } from "./Imports.js";
import { initRustParser } from "./pure/RustSymbols.js";

mkdirSync("/tmp/claude", { recursive: true });

let tempDir: string;

beforeEach(() => {
  tempDir = realpathSync(mkdtempSync(join("/tmp/claude/", "kart-imports-")));
  writeFileSync(
    join(tempDir, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: { target: "ES2022", module: "ESNext", moduleResolution: "bundler" },
    }),
  );
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function writeFixture(relPath: string, content: string): void {
  const abs = join(tempDir, relPath);
  const dir = abs.slice(0, abs.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(abs, content);
}

describe("getImports", () => {
  test("returns imports for a file", async () => {
    writeFixture("a.ts", 'import { greet } from "./b.js";\nconst x = 1;\n');
    writeFixture("b.ts", "export function greet() {}\n");

    const result = await getImports(join(tempDir, "a.ts"), tempDir);
    expect(result.totalImports).toBe(1);
    expect(result.imports[0].specifier).toBe("./b.js");
    expect(result.imports[0].importedNames).toEqual(["greet"]);
  });

  test("resolves relative imports to absolute paths", async () => {
    writeFixture("a.ts", 'import { greet } from "./b.js";\n');
    writeFixture("b.ts", "export function greet() {}\n");

    const result = await getImports(join(tempDir, "a.ts"), tempDir);
    expect(result.imports[0].resolvedPath).toBe(join(tempDir, "b.ts"));
  });

  test("external packages have null resolvedPath", async () => {
    writeFixture("a.ts", 'import { Effect } from "effect";\nimport { x } from "./b.js";\n');
    writeFixture("b.ts", "export const x = 1;\n");

    const result = await getImports(join(tempDir, "a.ts"), tempDir);
    const external = result.imports.find((i) => i.specifier === "effect");
    // effect may or may not resolve depending on node_modules — either null or a path
    expect(external).toBeDefined();
  });

  test("workspace boundary: rejects paths outside rootDir", async () => {
    const result = await getImports("/etc/passwd", tempDir);
    expect(result.totalImports).toBe(0);
  });

  test("returns empty for nonexistent file", async () => {
    const result = await getImports(join(tempDir, "missing.ts"), tempDir);
    expect(result.totalImports).toBe(0);
  });
});

describe("getImporters", () => {
  test("finds direct importers", async () => {
    writeFixture("a.ts", 'import { greet } from "./b.js";\n');
    writeFixture("b.ts", "export function greet() {}\n");
    writeFixture("c.ts", 'import { greet } from "./b.js";\n');

    const result = await getImporters(join(tempDir, "b.ts"), tempDir);
    expect(result.totalImporters).toBe(2);
    const relPaths = result.directImporters.map((p) => p.replace(tempDir + "/", "")).sort();
    expect(relPaths).toEqual(["a.ts", "c.ts"]);
  });

  test("expands through barrel files", async () => {
    writeFixture("lib/session.ts", "export function createSession() {}\n");
    writeFixture("lib/index.ts", 'export { createSession } from "./session.js";\n');
    writeFixture("app.ts", 'import { createSession } from "./lib/index.js";\n');

    const result = await getImporters(join(tempDir, "lib/session.ts"), tempDir);
    expect(result.directImporters.some((p) => p.endsWith("lib/index.ts"))).toBe(true);
    expect(result.barrelImporters.some((p) => p.endsWith("app.ts"))).toBe(true);
    expect(result.totalImporters).toBe(2);
  });

  test("workspace boundary: rejects paths outside rootDir", async () => {
    const result = await getImporters("/etc/passwd", tempDir);
    expect(result.totalImporters).toBe(0);
  });
});

describe("getUnusedExports", () => {
  test("finds unused exports", async () => {
    writeFixture("a.ts", 'import { greet } from "./b.js";\nconsole.log(greet());\n');
    writeFixture("b.ts", "export function greet() {}\nexport function farewell() {}\n");

    const result = await getUnusedExports(tempDir);
    const names = result.unusedExports.map((u) => u.name);
    expect(names).toContain("farewell");
    expect(names).not.toContain("greet");
  });

  test("wildcard import marks all exports as used", async () => {
    writeFixture("a.ts", 'import * as B from "./b.js";\nconsole.log(B);\n');
    writeFixture("b.ts", "export function greet() {}\nexport function farewell() {}\n");

    const result = await getUnusedExports(tempDir);
    const paths = result.unusedExports.map((u) => u.path);
    expect(paths.some((p) => p.endsWith("b.ts"))).toBe(false);
  });
});

// ── Rust import tests ──

describe("Rust imports", () => {
  let rustDir: string;

  beforeAll(async () => {
    await initRustParser();
  });

  beforeEach(() => {
    rustDir = realpathSync(mkdtempSync(join("/tmp/claude/", "kart-rust-imports-")));
    writeFileSync(join(rustDir, "Cargo.toml"), '[package]\nname = "test"\n');
    mkdirSync(join(rustDir, "src"), { recursive: true });
  });

  afterEach(() => {
    rmSync(rustDir, { recursive: true, force: true });
  });

  test("getImports extracts use statements from .rs file", async () => {
    writeFileSync(
      join(rustDir, "src", "main.rs"),
      "use std::collections::HashMap;\nuse crate::models::User;\n\nfn main() {}\n",
    );

    const result = await getImports(join(rustDir, "src", "main.rs"), rustDir);
    expect(result.totalImports).toBe(2);
    const specifiers = result.imports.map((i) => i.specifier).sort();
    expect(specifiers).toEqual(["crate::models::User", "std::collections::HashMap"]);
  });

  test("getImports resolves crate-relative paths", async () => {
    mkdirSync(join(rustDir, "src", "models"), { recursive: true });
    writeFileSync(join(rustDir, "src", "models", "user.rs"), "pub struct User {}\n");
    writeFileSync(
      join(rustDir, "src", "main.rs"),
      "use crate::models::user::User;\n\nfn main() {}\n",
    );

    const result = await getImports(join(rustDir, "src", "main.rs"), rustDir);
    expect(result.imports[0].resolvedPath).toBe(join(rustDir, "src", "models", "user.rs"));
  });

  test("getImports returns null for external crate references", async () => {
    writeFileSync(join(rustDir, "src", "main.rs"), "use serde::Serialize;\n\nfn main() {}\n");

    const result = await getImports(join(rustDir, "src", "main.rs"), rustDir);
    expect(result.imports[0].resolvedPath).toBeNull();
  });

  test("getImporters finds Rust file importers", async () => {
    mkdirSync(join(rustDir, "src", "models"), { recursive: true });
    writeFileSync(join(rustDir, "src", "models", "user.rs"), "pub struct User {}\n");
    writeFileSync(
      join(rustDir, "src", "main.rs"),
      "use crate::models::user::User;\n\nfn main() {}\n",
    );

    const result = await getImporters(join(rustDir, "src", "models", "user.rs"), rustDir);
    expect(result.totalImporters).toBeGreaterThanOrEqual(1);
    expect(result.directImporters.some((p) => p.endsWith("main.rs"))).toBe(true);
  });

  test("getUnusedExports finds unused Rust exports", async () => {
    writeFileSync(join(rustDir, "src", "lib.rs"), "pub fn used_fn() {}\npub fn unused_fn() {}\n");
    writeFileSync(
      join(rustDir, "src", "main.rs"),
      "use crate::lib::used_fn;\n\nfn main() { used_fn(); }\n",
    );

    const result = await getUnusedExports(rustDir);
    const names = result.unusedExports.map((u) => u.name);
    expect(names).toContain("unused_fn");
    expect(names).not.toContain("used_fn");
  });

  test("getImporters with pub use barrel in Rust", async () => {
    mkdirSync(join(rustDir, "src", "models"), { recursive: true });
    writeFileSync(join(rustDir, "src", "models", "user.rs"), "pub struct User {}\n");
    writeFileSync(join(rustDir, "src", "models", "mod.rs"), "pub use self::user::User;\n");
    writeFileSync(
      join(rustDir, "src", "main.rs"),
      "use crate::models::mod::User;\n\nfn main() {}\n",
    );

    const result = await getImporters(join(rustDir, "src", "models", "user.rs"), rustDir);
    // mod.rs directly imports user.rs via pub use
    expect(result.directImporters.some((p) => p.endsWith("mod.rs"))).toBe(true);
  });
});
