---
"@vevx/kart": minor
---

Add query-based tree-sitter AST plugin factory for multi-language support. Languages provide a grammar config (WASM file + S-expression query using tags.scm convention) and optional hooks for custom behavior. Migrate Rust from hardcoded RustSymbols.ts to factory with RustGrammar + RustHooks. Add PHP language support (grammar + intelephense LSP). Delete RustSymbols.ts — all generic logic in factory, Rust-specific in hooks.
