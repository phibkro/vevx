import { describe, test, expect } from "bun:test";
import { parsePlanXml } from "./parser.js";

const EXAMPLE_PLAN = `<?xml version="1.0" encoding="UTF-8"?>
<plan>
  <metadata>
    <feature>Rate Limiting</feature>
    <created>2026-02-16</created>
  </metadata>

  <contract>
    <preconditions>
      <condition id="pre-1">
        <description>Auth module has endpoint handlers</description>
        <verify>grep -r "router." src/auth/routes.ts</verify>
      </condition>
    </preconditions>

    <invariants>
      <invariant critical="true">
        <description>Existing auth tests pass throughout</description>
        <verify>npm test -- --filter=auth</verify>
      </invariant>
    </invariants>

    <postconditions>
      <condition id="post-1">
        <description>Rate limiting active on all auth endpoints</description>
        <verify>npm test -- --filter=rate-limit</verify>
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
</plan>`;

describe("parsePlanXml", () => {
  test("parses the example plan from design doc", () => {
    const plan = parsePlanXml(EXAMPLE_PLAN);

    expect(plan.metadata.feature).toBe("Rate Limiting");
    expect(plan.metadata.created).toBe("2026-02-16");
  });

  test("parses contract conditions", () => {
    const plan = parsePlanXml(EXAMPLE_PLAN);

    expect(plan.contract.preconditions).toHaveLength(1);
    expect(plan.contract.preconditions[0].id).toBe("pre-1");
    expect(plan.contract.invariants).toHaveLength(1);
    expect(plan.contract.invariants[0].critical).toBe(true);
    expect(plan.contract.postconditions).toHaveLength(1);
  });

  test("parses tasks with touches", () => {
    const plan = parsePlanXml(EXAMPLE_PLAN);

    expect(plan.tasks).toHaveLength(3);
    expect(plan.tasks[0].touches.writes).toEqual(["auth"]);
    expect(plan.tasks[0].touches.reads).toEqual(["api"]);
  });

  test("parses budget", () => {
    const plan = parsePlanXml(EXAMPLE_PLAN);

    expect(plan.tasks[0].budget.tokens).toBe(30000);
    expect(plan.tasks[0].budget.minutes).toBe(10);
  });

  test("parses comma-separated values", () => {
    const plan = parsePlanXml(EXAMPLE_PLAN);

    expect(plan.tasks[0].values).toEqual(["security", "correctness", "backwards-compatibility"]);
  });

  test("parses reads-only touches", () => {
    const plan = parsePlanXml(EXAMPLE_PLAN);

    expect(plan.tasks[2].touches.reads).toEqual(["auth", "api"]);
    expect(plan.tasks[2].touches.writes).toBeUndefined();
  });
});
