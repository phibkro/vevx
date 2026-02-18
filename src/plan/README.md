# Plan Schema

Reference for `plan.xml`, the execution plan that declares tasks, contracts, and resource budgets.

## Example

```xml
<plan>
  <metadata>
    <feature>Rate Limiting</feature>
    <created>2026-02-16</created>
  </metadata>

  <contract>
    <preconditions>
      <condition id="pre-1">
        <description>Auth module has endpoint handlers</description>
        <verify>grep -r "router\." src/auth/routes.ts</verify>
      </condition>
    </preconditions>

    <invariants>
      <invariant id="inv-1" critical="true">
        <description>Existing auth tests pass throughout</description>
        <verify>bun test --filter=auth</verify>
      </invariant>
    </invariants>

    <postconditions>
      <condition id="post-1">
        <description>Rate limiting active on all auth endpoints</description>
        <verify>bun test --filter=rate-limit</verify>
      </condition>
    </postconditions>
  </contract>

  <tasks>
    <task id="1">
      <description>Implement rate limiting middleware</description>
      <action>implement</action>
      <values>security, correctness, backwards-compatibility</values>
      <touches writes="auth" reads="api" />
      <budget tokens="30000" minutes="10" />
    </task>

    <task id="2">
      <description>Add rate limit integration tests</description>
      <action>test</action>
      <values>coverage, correctness</values>
      <touches writes="auth" reads="auth" />
      <budget tokens="20000" minutes="8" />
    </task>

    <task id="3">
      <description>Update API documentation</description>
      <action>document</action>
      <values>accuracy, completeness</values>
      <touches reads="auth, api" />
      <budget tokens="10000" minutes="5" />
    </task>
  </tasks>
</plan>
```

## Elements

### `<plan>`

Root element. Contains `<metadata>`, `<contract>`, and `<tasks>`.

### `<metadata>`

| Element | Required | Description |
|---------|----------|-------------|
| `<feature>` | yes | Human-readable feature name |
| `<created>` | yes | Creation date (ISO format, e.g. `2026-02-16`) |

### `<contract>`

Contains three sections of verifiable conditions. All sections are required but may be empty.

#### `<preconditions>`

Conditions that must hold before execution starts. Contains `<condition>` elements.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | attribute | yes | Unique identifier (e.g. `"pre-1"`) |
| `<description>` | element | yes | Human-readable description |
| `<verify>` | element | yes | Shell command that exits 0 on success |

#### `<invariants>`

Conditions that must hold throughout execution. Checked between task completions. Contains `<invariant>` elements.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | attribute | no | Unique identifier. Defaults to the description text if omitted. |
| `critical` | attribute | yes | `"true"` or `"false"`. Critical invariant failures cancel the entire wave. |
| `<description>` | element | yes | Human-readable description |
| `<verify>` | element | yes | Shell command that exits 0 on success |

#### `<postconditions>`

Conditions that must hold when all tasks complete. Contains `<condition>` elements (same schema as preconditions).

### `<tasks>`

Contains one or more `<task>` elements.

#### `<task>`

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | attribute | yes | Unique task identifier (e.g. `"1"`, `"auth-impl"`) |
| `<description>` | element | yes | What this task accomplishes |
| `<action>` | element | yes | Action verb: `implement`, `test`, `document`, `refactor`, `migrate`, etc. |
| `<values>` | element | yes | Comma-separated priority ordering (e.g. `"security, correctness"`) |
| `<touches>` | element | yes | Component read/write declarations (see below) |
| `<budget>` | element | yes | Resource limits (see below) |

#### `<touches>`

Self-closing element with attributes declaring which components this task reads from and writes to.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `writes` | no | Comma-separated component names this task modifies |
| `reads` | no | Comma-separated component names this task depends on |

```xml
<!-- Writes to auth, reads from api -->
<touches writes="auth" reads="api" />

<!-- Reads only (documentation task) -->
<touches reads="auth, api" />

<!-- Writes to multiple components -->
<touches writes="auth, api" reads="web" />
```

Component names must match entries in `varp.yaml`. The orchestrator uses these declarations to:
- **Schedule** — derive execution waves and detect data hazards (RAW/WAR/WAW)
- **Enforce** — verify file changes stay within declared write scope
- **Recover** — derive restart strategies from dependency overlap on failure

#### `<budget>`

Self-closing element with resource limits for this task.

| Attribute | Required | Description |
|-----------|----------|-------------|
| `tokens` | yes | Maximum token consumption (positive number) |
| `minutes` | yes | Maximum time in minutes (positive number) |

```xml
<budget tokens="30000" minutes="10" />
```

Budget guidelines:
- Directed tasks (explicit steps): 10k-30k tokens, 5-15 minutes
- Contract tasks (postconditions only): 20k-50k tokens, 10-30 minutes
- Test tasks: 15k-25k tokens, 5-15 minutes
- Documentation tasks: 5k-15k tokens, 3-10 minutes

## Verification Commands

All `<verify>` elements must be:

- **Idempotent** — safe to run multiple times
- **Exit-code-based** — 0 = pass, non-zero = fail
- **Runnable from project root** — no `cd` required
- **Non-interactive** — no prompts or stdin requirements

Prefer test suites over pattern matching:

```xml
<!-- Good: test suite, reliable -->
<verify>bun test --filter=rate-limit</verify>

<!-- Fragile: depends on code formatting -->
<verify>grep -r "rateLimiter" src/auth/</verify>
```

## Plan Modes

Tasks support two modes within the same plan:

- **Directed** — the `<description>` includes explicit implementation steps. The agent follows them. Use for well-understood work.
- **Contract** — the `<description>` states the goal, postconditions define success. The agent determines its own approach. Use for complex work.

The schema is identical for both modes. The difference is in how the description is written and how much latitude the executing agent has.

## Execution Order

Plans do not specify execution order. The orchestrator derives order from `touches` declarations by analyzing data hazards:

- **RAW** (read-after-write) — task B reads a component that task A writes. B must wait for A.
- **WAW** (write-after-write) — tasks A and B both write the same component. Scheduling constraint.
- **WAR** (write-after-read) — resolved by context snapshotting, not ordering.

Tasks with no hazards between them run in parallel within the same wave.

## Validation

Use `varp_validate_plan` to check a plan against the manifest. Validation catches:

- Components in `touches` that don't exist in the manifest
- Duplicate task IDs
- Missing or invalid budgets (must be positive numbers)
- WAW hazards (reported as warnings, not errors)

## Diffing

`varp_diff_plan` structurally compares two parsed plans and returns a `PlanDiff` with three sections:

- **`metadata`** — field-level changes to `feature` and `created`
- **`contracts`** — added, removed, or modified conditions/invariants, matched by `id` across preconditions, invariants, and postconditions
- **`tasks`** — added, removed, or modified tasks, matched by `id` with field-level detail (description, action, values, touches, budget)

The pure `diffPlans()` function accepts two `Plan` objects and performs no I/O. Matching is by ID — reordered entries with the same IDs don't produce diffs, only content differences are surfaced.

## File Location

Plans live in project memory: `~/.claude/projects/<project>/memory/plans/<feature-name>/plan.xml`. Completed plans are archived to `memory/plans/archive/`.
