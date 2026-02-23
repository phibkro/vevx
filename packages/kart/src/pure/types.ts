// ── LSP types ──

export type DocumentSymbol = {
  readonly name: string;
  readonly kind: number;
  readonly range: LspRange;
  readonly selectionRange: LspRange;
  readonly children?: readonly DocumentSymbol[];
};

export type LspRange = {
  readonly start: { readonly line: number; readonly character: number };
  readonly end: { readonly line: number; readonly character: number };
};

export type SemanticToken = {
  readonly line: number;
  readonly startChar: number;
  readonly length: number;
  readonly tokenType: number;
  readonly tokenModifiers: number;
};

export type SemanticTokensResult = {
  readonly tokens: readonly SemanticToken[];
  readonly resultId?: string;
};

// ── Hover types ──

export type HoverResult = {
  readonly contents: string;
};

// ── Call hierarchy types ──

export type CallHierarchyItem = {
  readonly name: string;
  readonly kind: number;
  readonly uri: string;
  readonly range: LspRange;
  readonly selectionRange: LspRange;
  readonly detail?: string;
  readonly tags?: readonly number[];
  readonly data?: unknown;
};

export type IncomingCallItem = {
  readonly from: CallHierarchyItem;
  readonly fromRanges: readonly LspRange[];
};

export type OutgoingCallItem = {
  readonly to: CallHierarchyItem;
  readonly fromRanges: readonly LspRange[];
};

// ── Impact types ──

export type ImpactNode = {
  readonly name: string;
  readonly kind: number;
  readonly uri: string;
  readonly range: LspRange;
  readonly fanOut: number;
  readonly callers: ImpactNode[];
};

export type ImpactResult = {
  readonly symbol: string;
  readonly path: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly totalNodes: number;
  readonly highFanOut: boolean;
  readonly root: ImpactNode;
};

// ── Deps types ──

export type DepsNode = {
  readonly name: string;
  readonly kind: number;
  readonly uri: string;
  readonly range: LspRange;
  readonly fanOut: number;
  readonly callees: DepsNode[];
};

export type DepsResult = {
  readonly symbol: string;
  readonly path: string;
  readonly depth: number;
  readonly maxDepth: number;
  readonly totalNodes: number;
  readonly highFanOut: boolean;
  readonly root: DepsNode;
};

// ── Reference types ──

export type Location = {
  readonly uri: string;
  readonly range: LspRange;
};

export type ReferenceEntry = {
  readonly path: string;
  readonly line: number;
  readonly character: number;
};

export type ReferencesResult = {
  readonly symbol: string;
  readonly path: string;
  readonly references: ReferenceEntry[];
  readonly totalReferences: number;
  /** True if the declaration site is included in references. */
  readonly includesDeclaration: boolean;
};

// ── Rename types ──

export type TextEdit = {
  readonly range: LspRange;
  readonly newText: string;
};

export type WorkspaceEdit = {
  readonly changes?: Record<string, TextEdit[]>;
};

export type RenameResult = {
  readonly symbol: string;
  readonly newName: string;
  readonly path: string;
  readonly filesModified: string[];
  readonly totalEdits: number;
};

// ── Definition types ──

export type DefinitionResult = {
  readonly symbol: string;
  readonly path: string;
  readonly definitions: ReferenceEntry[];
  readonly totalDefinitions: number;
};

export type TypeDefinitionResult = {
  readonly symbol: string;
  readonly path: string;
  readonly typeDefinitions: ReferenceEntry[];
  readonly totalTypeDefinitions: number;
};

export type ImplementationResult = {
  readonly symbol: string;
  readonly path: string;
  readonly implementations: ReferenceEntry[];
  readonly totalImplementations: number;
};

// ── Code action types ──

export type CodeActionEntry = {
  readonly title: string;
  readonly kind?: string;
  readonly isPreferred?: boolean;
  readonly diagnostics?: readonly { readonly message: string; readonly severity?: number }[];
};

export type CodeActionsResult = {
  readonly symbol: string;
  readonly path: string;
  readonly actions: CodeActionEntry[];
  readonly totalActions: number;
};

// ── Expand macro types (Rust only) ──

export type ExpandMacroResult = {
  readonly symbol: string;
  readonly path: string;
  readonly name: string;
  readonly expansion: string;
};

// ── Diagnostic types ──

export type Diagnostic = {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly severity: string;
  readonly message: string;
  readonly ruleId?: string;
};

// ── Zoom types ──

export type ZoomSymbol = {
  readonly name: string;
  readonly kind: string;
  readonly signature: string;
  readonly doc: string | null;
  readonly exported: boolean;
  readonly resolvedType?: string;
  readonly children?: ZoomSymbol[];
};

export type ZoomResult = {
  readonly path: string;
  readonly level: 0 | 1 | 2;
  readonly symbols: ZoomSymbol[];
  /**
   * Whether implementation bodies were omitted from signatures.
   * true for levels 0 and 1 (signatures only), false for level 2 (full content).
   */
  readonly truncated: boolean;
  readonly files?: ZoomResult[];
};

// ── Import graph types ──

export type ImportEntry = {
  /** The raw import specifier as written in source. */
  readonly specifier: string;
  /** Resolved absolute path (null if unresolvable — external package). */
  readonly resolvedPath: string | null;
  /** Imported symbol names. Empty for namespace/default imports. */
  readonly importedNames: readonly string[];
  /** True for `import type` or `export type`. */
  readonly isTypeOnly: boolean;
  /** True for `export { ... } from` or `export * from`. */
  readonly isReExport: boolean;
};

export type FileImports = {
  readonly path: string;
  readonly imports: readonly ImportEntry[];
  /** Exported symbol names from this file (for unused export detection). */
  readonly exportedNames: readonly string[];
  /** True if this file only contains re-exports (no local declarations). */
  readonly isBarrel: boolean;
};

export type ImportGraph = {
  /** Map from absolute file path to its imports. */
  readonly files: ReadonlyMap<string, FileImports>;
  /** Total files in the graph. */
  readonly fileCount: number;
  /** Total import statements processed. */
  readonly importCount: number;
  /** Milliseconds to build. */
  readonly durationMs: number;
};

export type ImportsResult = {
  readonly path: string;
  readonly imports: readonly {
    readonly specifier: string;
    readonly resolvedPath: string | null;
    readonly importedNames: readonly string[];
    readonly isTypeOnly: boolean;
  }[];
  readonly totalImports: number;
};

export type ImportersResult = {
  readonly path: string;
  /** Files that directly import this file. */
  readonly directImporters: readonly string[];
  /** Files that import this file through barrel re-exports. */
  readonly barrelImporters: readonly string[];
  /** All unique importers (direct + barrel). */
  readonly totalImporters: number;
};

// ── Inlay hints ──

export type InlayHint = {
  readonly position: { readonly line: number; readonly character: number };
  readonly label: string;
  /** 1 = type hint, 2 = parameter hint */
  readonly kind?: 1 | 2;
  readonly paddingLeft?: boolean;
  readonly paddingRight?: boolean;
};

export type InlayHintsResult = {
  readonly path: string;
  readonly hints: InlayHint[];
  readonly totalHints: number;
};

// ── Workspace symbol types ──

export type WorkspaceSymbolItem = {
  readonly name: string;
  readonly kind: number;
  readonly uri: string;
  readonly range: LspRange;
  readonly containerName?: string;
};

export type WorkspaceSymbolResult = {
  readonly query: string;
  readonly symbols: WorkspaceSymbolItem[];
  readonly totalSymbols: number;
};

export type UnusedExport = {
  readonly path: string;
  readonly name: string;
};

export type UnusedExportsResult = {
  readonly unusedExports: readonly UnusedExport[];
  readonly totalUnused: number;
  readonly totalExports: number;
  readonly fileCount: number;
  readonly durationMs: number;
};
