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
