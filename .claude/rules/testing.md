---
paths:
  - "**/*.test.ts"
  - "**/__tests__/**"
  - "**/fixtures.ts"
---

# Testing Patterns

Mechanical patterns for writing tests in this project. For guidelines on *what* to test, see the Code Quality Guidelines in `subagent-conventions.md`.

Tests run concurrently (`--concurrent`). Every test must be safe to run in parallel.

## Concurrent Safety

**Temp directories** — Use `withTempDir` to give each test its own directory:

```typescript
function withTempDir(fn: (dir: string) => Promise<void>): () => Promise<void> {
  return async () => {
    const dir = mkdtempSync(join("/tmp/claude", "my-prefix-"));
    try {
      await fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

it("reads config", withTempDir(async (dir) => {
  writeFileSync(join(dir, "config.yaml"), "key: value");
  const result = await loadConfig(dir);
  expect(result.key).toBe("value");
}));
```

Use `/tmp/claude/` prefix (not `/tmp/` directly — sandbox restricts it).

**Environment variables** — Use `test.serial` and save/restore:

```typescript
const serialTest = test.serial;

serialTest("reads API key from env", () => {
  const original = process.env.MY_KEY;
  try {
    process.env.MY_KEY = "test-key";
    expect(getKey()).toBe("test-key");
  } finally {
    if (original !== undefined) process.env.MY_KEY = original;
    else delete process.env.MY_KEY;
  }
});
```

## Parameterized Tests

When multiple subjects share the same test logic, use `describe.each`:

```typescript
describe.each(agents.map((a) => [a.name, a]))("%s Agent", (_name, agent) => {
  it("parses valid JSON", () => { ... });
  it("handles malformed JSON", () => { ... });
});
```

## Error Assertions

oxlint's `await-thenable` rule flags `await expect().rejects.toThrow()`. Use try/catch:

```typescript
try {
  await asyncFn();
  expect.unreachable("Should have thrown");
} catch (e) {
  expect((e as Error).message).toContain("message");
}
```

## Shared Fixtures

When 3+ test files create the same data, extract to `__tests__/fixtures.ts` with `Partial<T>` overrides:

```typescript
export function makeFinding(overrides: Partial<AuditFinding> = {}): AuditFinding {
  return { ruleId: "BAC-01", severity: "high", ...overrides };
}
```
