import { existsSync, readFileSync, watch } from "node:fs";
import { resolve } from "node:path";

import { Context, Effect, Layer, Scope } from "effect";

import { LspError, LspTimeoutError } from "./pure/Errors.js";

export type {
  CallHierarchyItem,
  DocumentSymbol,
  IncomingCallItem,
  Location,
  LspRange,
  OutgoingCallItem,
  SemanticToken,
  SemanticTokensResult,
  WorkspaceEdit,
} from "./pure/types.js";
import type {
  CallHierarchyItem,
  DocumentSymbol,
  IncomingCallItem,
  Location,
  OutgoingCallItem,
  SemanticToken,
  SemanticTokensResult,
  WorkspaceEdit,
} from "./pure/types.js";

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
    readonly prepareCallHierarchy: (
      uri: string,
      line: number,
      character: number,
    ) => Effect.Effect<CallHierarchyItem[], LspError | LspTimeoutError>;
    readonly incomingCalls: (
      item: CallHierarchyItem,
    ) => Effect.Effect<IncomingCallItem[], LspError | LspTimeoutError>;
    readonly outgoingCalls: (
      item: CallHierarchyItem,
    ) => Effect.Effect<OutgoingCallItem[], LspError | LspTimeoutError>;
    readonly references: (
      uri: string,
      line: number,
      character: number,
      includeDeclaration?: boolean,
    ) => Effect.Effect<Location[], LspError | LspTimeoutError>;
    readonly rename: (
      uri: string,
      line: number,
      character: number,
      newName: string,
    ) => Effect.Effect<WorkspaceEdit | null, LspError | LspTimeoutError>;
    readonly updateOpenDocument: (uri: string) => Effect.Effect<void, LspError>;
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
  /** Raw byte buffer — Content-Length is in bytes, not characters. */
  private buffer = new Uint8Array(0);
  private reading = false;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

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
    const encoded = this.encoder.encode(body);
    const header = `Content-Length: ${encoded.byteLength}\r\n\r\n`;
    this.stdin.write(header);
    this.stdin.write(encoded);
    void this.stdin.flush();
  }

  private async readLoop(): Promise<void> {
    const reader = this.stdout.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        this.appendToBuffer(value);
        this.processBuffer();
      }
    } finally {
      reader.releaseLock();
    }
  }

  private appendToBuffer(chunk: Uint8Array): void {
    const next = new Uint8Array(this.buffer.length + chunk.length);
    next.set(this.buffer, 0);
    next.set(chunk, this.buffer.length);
    this.buffer = next;
  }

  /** ASCII bytes for "\r\n\r\n" */
  private static readonly HEADER_DELIM = new Uint8Array([0x0d, 0x0a, 0x0d, 0x0a]);

  private findHeaderEnd(): number {
    const delim = JsonRpcTransport.HEADER_DELIM;
    for (let i = 0; i <= this.buffer.length - delim.length; i++) {
      if (
        this.buffer[i] === delim[0] &&
        this.buffer[i + 1] === delim[1] &&
        this.buffer[i + 2] === delim[2] &&
        this.buffer[i + 3] === delim[3]
      ) {
        return i;
      }
    }
    return -1;
  }

  private processBuffer(): void {
    while (true) {
      const headerEnd = this.findHeaderEnd();
      if (headerEnd === -1) return;

      const headerStr = this.decoder.decode(this.buffer.subarray(0, headerEnd));
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + contentLength;

      if (this.buffer.length < bodyEnd) return;

      const bodyStr = this.decoder.decode(this.buffer.subarray(bodyStart, bodyEnd));
      this.buffer = this.buffer.subarray(bodyEnd);

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

// ── Language server configuration ──

export type LanguageServerConfig = {
  /** Binary name to find/spawn. */
  readonly binary: string;
  /** CLI args (e.g. ["--stdio"]). */
  readonly args: readonly string[];
  /** Map file path → LSP languageId. */
  readonly languageId: (path: string) => string;
  /** File extensions to watch for changes. */
  readonly watchExtensions: ReadonlySet<string>;
  /** Specific filenames to watch (e.g. tsconfig.json). */
  readonly watchFilenames: ReadonlySet<string>;
};

export const tsLanguageServer: LanguageServerConfig = {
  binary: "typescript-language-server",
  args: ["--stdio"],
  languageId: (path) => (path.endsWith(".tsx") ? "typescriptreact" : "typescript"),
  watchExtensions: new Set([".ts", ".tsx"]),
  watchFilenames: new Set(["tsconfig.json", "package.json"]),
};

export const rustLanguageServer: LanguageServerConfig = {
  binary: "rust-analyzer",
  args: [],
  languageId: () => "rust",
  watchExtensions: new Set([".rs"]),
  watchFilenames: new Set(["Cargo.toml", "Cargo.lock"]),
};

// ── Binary resolution ──

function findLspBinary(rootDir: string, binaryName: string): string {
  // Check node_modules/.bin relative to rootDir first
  const localPath = resolve(rootDir, "node_modules", ".bin", binaryName);
  if (existsSync(localPath)) return localPath;

  // Try global — Bun.which is synchronous
  const globalPath = Bun.which(binaryName);
  if (globalPath) return globalPath;

  throw new LspError({
    message: `${binaryName} not found. Ensure it is installed and on your PATH.`,
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

// ── File watching ──

/** LSP FileChangeType enum values. */
const FileChangeType = { Created: 1, Changed: 2, Deleted: 3 } as const;

function shouldWatch(filename: string, lsConfig: LanguageServerConfig): boolean {
  if (lsConfig.watchFilenames.has(filename)) return true;
  for (const ext of lsConfig.watchExtensions) {
    if (filename.endsWith(ext)) return true;
  }
  return false;
}

// ── Layer ──

export type LspConfig = {
  /** Absolute path to the workspace root. Defaults to process.cwd(). */
  readonly rootDir?: string;
  /** Language server configuration. Defaults to TypeScript. */
  readonly languageServer?: LanguageServerConfig;
};

export const LspClientLive = (config: LspConfig = {}): Layer.Layer<LspClient> =>
  Layer.orDie(
    Layer.scoped(
      LspClient,
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        const rootDir = config.rootDir ?? process.cwd();
        const rootUri = `file://${rootDir}`;
        const lsConfig = config.languageServer ?? tsLanguageServer;

        // Find binary
        const binary = yield* Effect.try({
          try: () => findLspBinary(rootDir, lsConfig.binary),
          catch: (e) =>
            e instanceof LspError ? e : new LspError({ message: String(e), cause: e }),
        });

        // Spawn the language server
        const proc = yield* Effect.try({
          try: () =>
            Bun.spawn([binary, ...lsConfig.args], {
              stdin: "pipe",
              stdout: "pipe",
              stderr: "pipe",
            }),
          catch: (e) =>
            new LspError({
              message: `Failed to spawn ${lsConfig.binary}: ${String(e)}`,
              cause: e,
            }),
        });

        const transport = new JsonRpcTransport(proc.stdin as unknown as BunFileSink, proc.stdout);
        transport.startReading();

        // Track open documents so we can close them on shutdown
        const openDocumentVersions = new Map<string, number>();
        let shutdownCalled = false;

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
                  callHierarchy: {
                    dynamicRegistration: false,
                  },
                },
                workspace: {
                  didChangeWatchedFiles: {
                    dynamicRegistration: false,
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
            // Skip if explicit shutdown() already ran
            if (shutdownCalled) return;

            // Stop file watcher
            watcher.close();

            // Close any open documents
            for (const uri of openDocumentVersions.keys()) {
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
            if (openDocumentVersions.has(uri)) return;

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
                    languageId: lsConfig.languageId(filePath),
                    version: 1,
                    text: content,
                  },
                }),
              catch: (e) =>
                new LspError({ message: `didOpen failed for ${uri}: ${String(e)}`, cause: e }),
            });

            openDocumentVersions.set(uri, 1);
          });

        // Helper: notify LSP that an already-open document changed on disk
        const notifyDocumentChanged = (uri: string): void => {
          const version = openDocumentVersions.get(uri);
          if (version == null) return; // Not open — the next ensureDocumentOpen will read fresh content

          const filePath = uri.startsWith("file://") ? uri.slice(7) : uri;
          try {
            const content = readFileSync(filePath, "utf-8");
            const nextVersion = version + 1;
            openDocumentVersions.set(uri, nextVersion);
            transport.notify("textDocument/didChange", {
              textDocument: { uri, version: nextVersion },
              contentChanges: [{ text: content }],
            });
          } catch {
            // File may have been deleted — remove from tracking so next access re-opens
            openDocumentVersions.delete(uri);
          }
        };

        // Start file watcher to keep LSP in sync with external edits
        const watcher = yield* Effect.try({
          try: () => {
            const w = watch(rootDir, { recursive: true }, (eventType, filename) => {
              if (!filename || !shouldWatch(filename, lsConfig)) return;

              const absPath = resolve(rootDir, filename);
              const uri = `file://${absPath}`;

              // Notify LSP about filesystem change
              const changeType =
                eventType === "rename"
                  ? existsSync(absPath)
                    ? FileChangeType.Created
                    : FileChangeType.Deleted
                  : FileChangeType.Changed;

              transport.notify("workspace/didChangeWatchedFiles", {
                changes: [{ uri, type: changeType }],
              });

              // If the document is already open, send didChange so LSP picks up new content
              if (changeType !== FileChangeType.Deleted) {
                notifyDocumentChanged(uri);
              } else {
                openDocumentVersions.delete(uri);
              }
            });
            // Ignore watcher errors (e.g. EMFILE on macOS) — stale state is acceptable fallback
            w.on("error", () => {});
            return w;
          },
          catch: (e) =>
            new LspError({ message: `Failed to start file watcher: ${String(e)}`, cause: e }),
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

          prepareCallHierarchy: (uri, line, character) =>
            Effect.gen(function* () {
              yield* ensureDocumentOpen(uri);

              const result = yield* Effect.tryPromise({
                try: () =>
                  transport.request("textDocument/prepareCallHierarchy", {
                    textDocument: { uri },
                    position: { line, character },
                  }),
                catch: (e) =>
                  e instanceof LspTimeoutError
                    ? e
                    : new LspError({
                        message: `prepareCallHierarchy request failed: ${String(e)}`,
                        cause: e,
                      }),
              });

              if (!Array.isArray(result)) return [];
              return result as CallHierarchyItem[];
            }),

          incomingCalls: (item) =>
            Effect.gen(function* () {
              const result = yield* Effect.tryPromise({
                try: () => transport.request("callHierarchy/incomingCalls", { item }),
                catch: (e) =>
                  e instanceof LspTimeoutError
                    ? e
                    : new LspError({
                        message: `incomingCalls request failed: ${String(e)}`,
                        cause: e,
                      }),
              });

              if (!Array.isArray(result)) return [];
              return result as IncomingCallItem[];
            }),

          outgoingCalls: (item) =>
            Effect.gen(function* () {
              const result = yield* Effect.tryPromise({
                try: () => transport.request("callHierarchy/outgoingCalls", { item }),
                catch: (e) =>
                  e instanceof LspTimeoutError
                    ? e
                    : new LspError({
                        message: `outgoingCalls request failed: ${String(e)}`,
                        cause: e,
                      }),
              });

              if (!Array.isArray(result)) return [];
              return result as OutgoingCallItem[];
            }),

          references: (uri, line, character, includeDeclaration = true) =>
            Effect.gen(function* () {
              yield* ensureDocumentOpen(uri);

              const result = yield* Effect.tryPromise({
                try: () =>
                  transport.request("textDocument/references", {
                    textDocument: { uri },
                    position: { line, character },
                    context: { includeDeclaration },
                  }),
                catch: (e) =>
                  e instanceof LspTimeoutError
                    ? e
                    : new LspError({
                        message: `references request failed: ${String(e)}`,
                        cause: e,
                      }),
              });

              if (!Array.isArray(result)) return [];
              return result as Location[];
            }),

          rename: (uri, line, character, newName) =>
            Effect.gen(function* () {
              yield* ensureDocumentOpen(uri);

              const result = yield* Effect.tryPromise({
                try: () =>
                  transport.request("textDocument/rename", {
                    textDocument: { uri },
                    position: { line, character },
                    newName,
                  }),
                catch: (e) =>
                  e instanceof LspTimeoutError
                    ? e
                    : new LspError({
                        message: `rename request failed: ${String(e)}`,
                        cause: e,
                      }),
              });

              if (!result || typeof result !== "object") return null;
              return result as WorkspaceEdit;
            }),

          updateOpenDocument: (uri) =>
            Effect.try({
              try: () => notifyDocumentChanged(uri),
              catch: (e) =>
                new LspError({
                  message: `updateOpenDocument failed for ${uri}: ${String(e)}`,
                  cause: e,
                }),
            }),

          shutdown: () =>
            Effect.tryPromise({
              try: async () => {
                shutdownCalled = true;
                watcher.close();
                await transport.request("shutdown", null, 5_000);
                transport.notify("exit");
                transport.drain();
                proc.kill();
                openDocumentVersions.clear();
              },
              catch: (e) => new LspError({ message: `Shutdown failed: ${String(e)}`, cause: e }),
            }),
        });
      }),
    ),
  );
