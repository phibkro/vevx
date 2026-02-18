import { readFileSync } from "node:fs";

import { XMLParser } from "fast-xml-parser";

import { ExecutionLogSchema, type ExecutionLog } from "#shared/types.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["task", "check", "observation", "file", "wave"].includes(name),
  processEntities: false,
});

export function parseLogXml(xmlContent: string): ExecutionLog {
  const parsed = xmlParser.parse(xmlContent);
  const log = parsed.log;

  const session = {
    started: log.session["@_started"],
    mode: log.session["@_mode"],
  };

  const costEl = log.cost;
  const cost = costEl
    ? {
        total_cost_usd: Number(costEl["@_total_cost_usd"]),
        total_input_tokens: Number(costEl["@_total_input_tokens"]),
        total_output_tokens: Number(costEl["@_total_output_tokens"]),
      }
    : undefined;

  const tasks = (log.tasks?.task ?? []).map((t: any) => {
    const costUsd = t.metrics?.["@_cost_usd"];
    return {
      id: String(t["@_id"]),
      status: t["@_status"],
      metrics: {
        tokens: Number(t.metrics?.["@_tokens"] ?? 0),
        minutes: Number(t.metrics?.["@_minutes"] ?? 0),
        tools: Number(t.metrics?.["@_tools"] ?? 0),
        ...(costUsd != null ? { cost_usd: Number(costUsd) } : {}),
      },
      files_modified: (t.files_modified?.file ?? []).map((f: any) =>
        typeof f === "string" ? f : String(f),
      ),
      postconditions: (t.postconditions?.check ?? []).map((c: any) => ({
        id: c["@_id"],
        result: c["@_result"],
      })),
      observations: (t.observations?.observation ?? []).map((o: any) =>
        typeof o === "string" ? o : String(o),
      ),
    };
  });

  const invariantChecks = (log.invariant_checks?.wave ?? []).map((w: any) => ({
    wave: Number(w["@_id"]),
    checks: (w.check ?? []).map((c: any) => ({
      description: typeof c === "string" ? c : (c["#text"] ?? c.description ?? String(c)),
      result: c["@_result"],
    })),
  }));

  const waves = (log.waves?.wave ?? []).map((w: any) => ({
    id: Number(w["@_id"]),
    status: w["@_status"],
  }));

  return ExecutionLogSchema.parse({
    session,
    cost,
    tasks,
    invariant_checks: invariantChecks,
    waves,
  });
}

export function parseLogFile(path: string): ExecutionLog {
  const content = readFileSync(path, "utf-8");
  return parseLogXml(content);
}
