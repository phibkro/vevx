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
