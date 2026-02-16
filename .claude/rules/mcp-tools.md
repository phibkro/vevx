---
paths:
  - "src/**/*.ts"
---

# MCP Tool Development

## Adding a New Tool

1. Write the pure function in the appropriate module (`manifest/`, `scheduler/`, `plan/`, `enforcement/`)
2. Define Zod input schema (reuse from `types.ts` where possible)
3. Register in `src/index.ts` via `server.tool(name, description, schema, handler)`
4. Handler pattern: parse manifest internally, call pure function, return `{ content: [{ type: "text", text: JSON.stringify(result) }] }`
5. Wrap in try/catch returning `{ isError: true }` on failure
6. Add unit tests for the pure function + integration test in `src/index.test.ts`

## Testing MCP Tools

Integration tests use in-process transport (no subprocess/stdio):

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "./index.js";

const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
const server = createServer();
const client = new Client({ name: "test", version: "1.0.0" });
await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

const result = await client.callTool({ name: "varp_read_manifest", arguments: {} });
const data = JSON.parse(result.content[0].text);
```

## Zod Convention

Every type is a Zod schema first. Never define a standalone TypeScript interface.

```typescript
// Correct
export const FooSchema = z.object({ bar: z.string() });
export type Foo = z.infer<typeof FooSchema>;

// Wrong — type drift risk
export interface Foo { bar: string }
```
