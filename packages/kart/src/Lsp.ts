import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { Context, Effect, Layer, Scope } from "effect";

import { LspError, LspTimeoutError } from "./Errors.js";

// ── Types ──

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

// ── Service ──

export class LspClient extends Context.Tag("kart/LspClient")<
  LspClient,
  {
    readonly documentSymbol: (
      uri: string,
    ) => Effect.Effect<DocumentSymbol[], LspError | LspTimeoutError>;
    readonly semanticTokens: (
      uri: string,
    ) => Effect.Effect<SemanticTokensResult, LspError | LspTimeoutError>;
    readonly shutdown: () => Effect.Effect<void, LspError>;
  }
>() {}

// ── JSON-RPC Transport ──

/** Bun.spawn stdin type — a FileSink with write/flush/end */
type BunFileSink = {
  write(data: string | Uint8Array): number;
  flush(): void | Promise<void>;
  end(): void;
};

type PendingRequest = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
};

class JsonRpcTransport {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private buffer = "";
  private reading = false;

  constructor(
    private readonly stdin: BunFileSink,
    private readonly stdout: ReadableStream<Uint8Array>,
  ) {}

  /** Start reading responses from stdout. Call once after construction. */
  startReading(): void {
    if (this.reading) return;
    this.reading = true;
    this.readLoop().catch((err) => {
      for (const [id, p] of this.pending) {
        p.reject(new LspError({ message: `Read loop failed: ${err}`, cause: err }));
        this.pending.delete(id);
      }
    });
  }

  /** Send a JSON-RPC request and wait for the response. */
  async request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId++;
    const body = JSON.stringify({ jsonrpc: "2.0", id, method, params });
    this.writeMessage(body);

    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        rej(new LspTimeoutError({ request: method, timeoutMs }));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          res(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          rej(e);
        },
      });
    });
  }

  /** Send a JSON-RPC notification (no response expected). */
  notify(method: string, params: unknown = {}): void {
    const body = JSON.stringify({ jsonrpc: "2.0", method, params });
    this.writeMessage(body);
  }

  /** Drain pending requests on shutdown. */
  drain(): void {
    for (const [id, p] of this.pending) {
      p.reject(new LspError({ message: "Transport shutting down" }));
      this.pending.delete(id);
    }
  }

  private writeMessage(body: string): void {
    const encoded = new TextEncoder().encode(body);
    const header = `Content-Length: ${encoded.byteLength}\r\n\r\n`;
    this.stdin.write(header);
    this.stdin.write(encoded);
    void this.stdin.flush();
  }

  private async readLoop(): Promise<void> {
    const reader = this.stdout.getReader();
    const decoder = new TextDecoder();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        this.processBuffer();
      }
    } finally {
      reader.releaseLock();
    }
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd === -1) return;

      const header = this.buffer.slice(0, headerEnd);
      const match = header.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        this.buffer = this.buffer.slice(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) return;

      const bodyStr = this.buffer.slice(bodyStart, bodyEnd);
      this.buffer = this.buffer.slice(bodyEnd);

      try {
        const msg = JSON.parse(bodyStr);
        this.handleMessage(msg);
      } catch {
        // Malformed JSON — skip
      }
    }
  }

  private handleMessage(msg: {
    id?: number;
    result?: unknown;
    error?: { code: number; message: string };
  }): void {
    if (msg.id == null) return;

    const pending = this.pending.get(msg.id);
    if (!pending) return;

    this.pending.delete(msg.id);

    if (msg.error) {
      pending.reject(
        new LspError({ message: `LSP error: ${msg.error.message} (${msg.error.code})` }),
      );
    } else {
      pending.resolve(msg.result);
    }
  }
}

// ── Binary resolution ──

function findLspBinary(): string {
  // Check node_modules/.bin first
  const localPath = resolve("node_modules", ".bin", "typescript-language-server");
  try {
    // Check if the file exists and is executable
    readFileSync(localPath);
    return localPath;
  } catch {
    // Fall through to global
  }

  // Try global — Bun.which is synchronous
  const globalPath = Bun.which("typescript-language-server");
  if (globalPath) return globalPath;

  throw new LspError({
    message:
      "typescript-language-server not found. Install it: bun add -d typescript-language-server typescript",
  });
}

// ── Decode semantic tokens ──

function decodeSemanticTokens(data: number[]): SemanticToken[] {
  const tokens: SemanticToken[] = [];
  let line = 0;
  let startChar = 0;

  for (let i = 0; i < data.length; i += 5) {
    const deltaLine = data[i];
    const deltaStart = data[i + 1];
    const length = data[i + 2];
    const tokenType = data[i + 3];
    const tokenModifiers = data[i + 4];

    if (deltaLine > 0) {
      line += deltaLine;
      startChar = deltaStart;
    } else {
      startChar += deltaStart;
    }

    tokens.push({ line, startChar, length, tokenType, tokenModifiers });
  }

  return tokens;
}

// ── LSP capability constants ──

const SEMANTIC_TOKEN_TYPES = [
  "namespace",
  "type",
  "class",
  "enum",
  "interface",
  "struct",
  "typeParameter",
  "parameter",
  "variable",
  "property",
  "enumMember",
  "event",
  "function",
  "method",
  "macro",
  "keyword",
  "modifier",
  "comment",
  "string",
  "number",
  "regexp",
  "operator",
  "decorator",
] as const;

const SEMANTIC_TOKEN_MODIFIERS = [
  "declaration",
  "definition",
  "readonly",
  "static",
  "deprecated",
  "abstract",
  "async",
  "modification",
  "documentation",
  "defaultLibrary",
] as const;

// ── Layer ──

export type LspConfig = {
  /** Absolute path to the workspace root. Defaults to process.cwd(). */
  readonly rootDir?: string;
};

export const LspClientLive = (config: LspConfig = {}): Layer.Layer<LspClient> =>
  Layer.scoped(
    LspClient,
    Effect.gen(function* () {
      const scope = yield* Scope.Scope;
      const rootDir = config.rootDir ?? process.cwd();
      const rootUri = `file://${rootDir}`;

      // Find binary
      const binary = yield* Effect.try({
        try: () => findLspBinary(),
        catch: (e) => (e instanceof LspError ? e : new LspError({ message: String(e), cause: e })),
      });

      // Spawn the language server
      const proc = yield* Effect.try({
        try: () =>
          Bun.spawn([binary, "--stdio"], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          }),
        catch: (e) =>
          new LspError({
            message: `Failed to spawn typescript-language-server: ${String(e)}`,
            cause: e,
          }),
      });

      const transport = new JsonRpcTransport(proc.stdin as unknown as BunFileSink, proc.stdout);
      transport.startReading();

      // Track open documents so we can close them on shutdown
      const openDocuments = new Set<string>();

      // Initialize handshake
      yield* Effect.tryPromise({
        try: () =>
          transport.request("initialize", {
            processId: process.pid,
            capabilities: {
              textDocument: {
                documentSymbol: {
                  hierarchicalDocumentSymbolSupport: true,
                },
                semanticTokens: {
                  requests: { full: true },
                  tokenTypes: [...SEMANTIC_TOKEN_TYPES],
                  tokenModifiers: [...SEMANTIC_TOKEN_MODIFIERS],
                  formats: ["relative"],
                },
              },
              workspace: {
                didChangeWatchedFiles: {
                  dynamicRegistration: true,
                },
              },
            },
            rootUri,
            workspaceFolders: [{ uri: rootUri, name: "workspace" }],
          }),
        catch: (e) =>
          e instanceof LspTimeoutError
            ? e
            : new LspError({ message: `Initialize failed: ${String(e)}`, cause: e }),
      });

      // Send initialized notification
      yield* Effect.try({
        try: () => transport.notify("initialized"),
        catch: (e) =>
          new LspError({ message: `initialized notification failed: ${String(e)}`, cause: e }),
      });

      // Register release finalizer
      yield* Scope.addFinalizer(
        scope,
        Effect.gen(function* () {
          // Close any open documents
          for (const uri of openDocuments) {
            yield* Effect.try({
              try: () =>
                transport.notify("textDocument/didClose", {
                  textDocument: { uri },
                }),
              catch: () => new LspError({ message: `Failed to close document: ${uri}` }),
            }).pipe(Effect.catchAll(() => Effect.void));
          }

          // Shutdown request
          yield* Effect.tryPromise({
            try: () => transport.request("shutdown", null, 5_000),
            catch: () => new LspError({ message: "LSP shutdown request failed" }),
          }).pipe(Effect.catchAll(() => Effect.void));

          // Exit notification
          yield* Effect.try({
            try: () => transport.notify("exit"),
            catch: () => new LspError({ message: "LSP exit notification failed" }),
          }).pipe(Effect.catchAll(() => Effect.void));

          transport.drain();

          // Kill process
          yield* Effect.sync(() => {
            proc.kill();
          });
        }),
      );

      // Helper: ensure document is open before requesting
      const ensureDocumentOpen = (uri: string): Effect.Effect<void, LspError | LspTimeoutError> =>
        Effect.gen(function* () {
          if (openDocuments.has(uri)) return;

          const filePath = uri.startsWith("file://") ? uri.slice(7) : uri;
          const content = yield* Effect.try({
            try: () => readFileSync(filePath, "utf-8"),
            catch: (e) => new LspError({ message: `Failed to read file: ${filePath}`, cause: e }),
          });

          yield* Effect.try({
            try: () =>
              transport.notify("textDocument/didOpen", {
                textDocument: {
                  uri,
                  languageId: filePath.endsWith(".tsx") ? "typescriptreact" : "typescript",
                  version: 1,
                  text: content,
                },
              }),
            catch: (e) =>
              new LspError({ message: `didOpen failed for ${uri}: ${String(e)}`, cause: e }),
          });

          openDocuments.add(uri);
        });

      return LspClient.of({
        documentSymbol: (uri) =>
          Effect.gen(function* () {
            yield* ensureDocumentOpen(uri);

            const result = yield* Effect.tryPromise({
              try: () =>
                transport.request("textDocument/documentSymbol", {
                  textDocument: { uri },
                }),
              catch: (e) =>
                e instanceof LspTimeoutError
                  ? e
                  : new LspError({
                      message: `documentSymbol request failed: ${String(e)}`,
                      cause: e,
                    }),
            });

            if (!Array.isArray(result)) return [];
            return result as DocumentSymbol[];
          }),

        semanticTokens: (uri) =>
          Effect.gen(function* () {
            yield* ensureDocumentOpen(uri);

            const result = yield* Effect.tryPromise({
              try: () =>
                transport.request("textDocument/semanticTokens/full", {
                  textDocument: { uri },
                }),
              catch: (e) =>
                e instanceof LspTimeoutError
                  ? e
                  : new LspError({
                      message: `semanticTokens request failed: ${String(e)}`,
                      cause: e,
                    }),
            });

            const typed = result as { data?: number[]; resultId?: string } | null;
            if (!typed?.data) return { tokens: [] };

            return {
              tokens: decodeSemanticTokens(typed.data),
              resultId: typed.resultId,
            };
          }),

        shutdown: () =>
          Effect.tryPromise({
            try: async () => {
              await transport.request("shutdown", null, 5_000);
              transport.notify("exit");
              transport.drain();
              proc.kill();
              openDocuments.clear();
            },
            catch: (e) => new LspError({ message: `Shutdown failed: ${String(e)}`, cause: e }),
          }),
      });
    }),
  );
