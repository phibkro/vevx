import { describe, test, expect } from "bun:test";
import { join } from "node:path";

import { parseLogXml, parseLogFile } from "./log-parser.js";

const SAMPLE_LOG = `<log>
  <session started="2026-02-18T10:00:00Z" mode="sequential" />
  <tasks>
    <task id="1" status="COMPLETE">
      <metrics tokens="25000" minutes="8" tools="42" />
      <files_modified>
        <file>src/auth/login.ts</file>
        <file>src/auth/session.ts</file>
      </files_modified>
      <postconditions>
        <check id="post-1" result="pass" />
      </postconditions>
      <observations>
        <observation>Refactored auth</observation>
      </observations>
    </task>
    <task id="2" status="BLOCKED">
      <metrics tokens="5000" minutes="2" tools="10" />
      <files_modified />
      <postconditions />
      <observations>
        <observation>Blocked on upstream</observation>
      </observations>
    </task>
  </tasks>
  <invariant_checks>
    <wave id="1">
      <check result="pass">Tests pass</check>
      <check result="fail">Lint clean</check>
    </wave>
  </invariant_checks>
  <waves>
    <wave id="1" status="complete" />
    <wave id="2" status="incomplete" />
  </waves>
</log>`;

describe("parseLogXml", () => {
  test("parses session metadata", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.session.started).toBe("2026-02-18T10:00:00Z");
    expect(log.session.mode).toBe("sequential");
  });

  test("parses tasks with metrics", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.tasks).toHaveLength(2);

    const task1 = log.tasks[0];
    expect(task1.id).toBe("1");
    expect(task1.status).toBe("COMPLETE");
    expect(task1.metrics).toEqual({ tokens: 25000, minutes: 8, tools: 42 });
    expect(task1.metrics.cost_usd).toBeUndefined();
  });

  test("parses files_modified", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.tasks[0].files_modified).toEqual(["src/auth/login.ts", "src/auth/session.ts"]);
  });

  test("parses empty files_modified", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.tasks[1].files_modified).toEqual([]);
  });

  test("parses postconditions", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.tasks[0].postconditions).toEqual([{ id: "post-1", result: "pass" }]);
  });

  test("parses observations", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.tasks[0].observations).toEqual(["Refactored auth"]);
    expect(log.tasks[1].observations).toEqual(["Blocked on upstream"]);
  });

  test("parses invariant checks", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.invariant_checks).toHaveLength(1);
    expect(log.invariant_checks[0].wave).toBe(1);
    expect(log.invariant_checks[0].checks).toEqual([
      { description: "Tests pass", result: "pass" },
      { description: "Lint clean", result: "fail" },
    ]);
  });

  test("parses waves", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.waves).toEqual([
      { id: 1, status: "complete" },
      { id: 2, status: "incomplete" },
    ]);
  });

  test("parses cost_usd on task metrics", () => {
    const xml = `<log>
      <session started="2026-01-01" mode="sequential" />
      <tasks>
        <task id="1" status="COMPLETE">
          <metrics tokens="25000" minutes="8" tools="42" cost_usd="0.12" />
          <files_modified /><postconditions /><observations />
        </task>
      </tasks>
      <invariant_checks /><waves />
    </log>`;
    const log = parseLogXml(xml);
    expect(log.tasks[0].metrics.cost_usd).toBe(0.12);
  });

  test("parses plan-level cost element", () => {
    const xml = `<log>
      <session started="2026-01-01" mode="parallel" />
      <cost total_cost_usd="0.45" total_input_tokens="125000" total_output_tokens="18000" />
      <tasks /><invariant_checks /><waves />
    </log>`;
    const log = parseLogXml(xml);
    expect(log.cost).toEqual({
      total_cost_usd: 0.45,
      total_input_tokens: 125000,
      total_output_tokens: 18000,
    });
  });

  test("cost is undefined when cost element is absent", () => {
    const log = parseLogXml(SAMPLE_LOG);
    expect(log.cost).toBeUndefined();
  });

  test("parses all session modes", () => {
    for (const mode of ["single-scope", "sequential", "parallel"] as const) {
      const xml = `<log>
        <session started="2026-01-01" mode="${mode}" />
        <tasks /><invariant_checks /><waves />
      </log>`;
      const log = parseLogXml(xml);
      expect(log.session.mode).toBe(mode);
    }
  });
});

describe("parseLogFile", () => {
  test("parses fixture file", () => {
    const fixturePath = join(import.meta.dir, "..", "..", "test-fixtures", "test-log.xml");
    const log = parseLogFile(fixturePath);

    expect(log.session.mode).toBe("sequential");
    expect(log.cost).toEqual({
      total_cost_usd: 0.38,
      total_input_tokens: 95000,
      total_output_tokens: 12000,
    });
    expect(log.tasks).toHaveLength(2);
    expect(log.tasks[0].status).toBe("COMPLETE");
    expect(log.tasks[0].metrics.cost_usd).toBe(0.24);
    expect(log.tasks[1].status).toBe("PARTIAL");
    expect(log.tasks[1].metrics.cost_usd).toBeUndefined();
    expect(log.invariant_checks).toHaveLength(2);
    expect(log.waves).toHaveLength(2);
  });
});
