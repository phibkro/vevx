import { readFileSync } from "node:fs";

import { XMLParser } from "fast-xml-parser";

import { PlanSchema, type Plan } from "#shared/types.js";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["condition", "invariant", "task"].includes(name),
  processEntities: false,
});

function parseValues(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseTouches(attrs: Record<string, string>): { writes?: string[]; reads?: string[] } {
  const result: { writes?: string[]; reads?: string[] } = {};
  if (attrs["@_writes"]) {
    result.writes = attrs["@_writes"].split(",").map((s) => s.trim());
  }
  if (attrs["@_reads"]) {
    result.reads = attrs["@_reads"].split(",").map((s) => s.trim());
  }
  return result;
}

export function parsePlanXml(xmlContent: string): Plan {
  const parsed = xmlParser.parse(xmlContent);
  const plan = parsed.plan;

  const metadata = {
    feature: plan.metadata.feature,
    created: plan.metadata.created,
  };

  const contract = {
    preconditions: (plan.contract?.preconditions?.condition ?? []).map((c: any) => ({
      id: c["@_id"],
      description: c.description,
      verify: c.verify,
    })),
    invariants: (plan.contract?.invariants?.invariant ?? []).map((i: any, idx: number) => ({
      id: i["@_id"] ?? `invariant-${idx}`,
      description: i.description,
      verify: i.verify,
      critical: i["@_critical"] === "true" || i["@_critical"] === true,
    })),
    postconditions: (plan.contract?.postconditions?.condition ?? []).map((c: any) => ({
      id: c["@_id"],
      description: c.description,
      verify: c.verify,
    })),
  };

  // Note: <budget> elements are accepted but ignored (deprecated per ADR-001)
  const tasks = (plan.tasks?.task ?? []).map((t: any) => {
    const task: Record<string, unknown> = {
      id: String(t["@_id"]),
      description: t.description,
      action: t.action,
      values: parseValues(typeof t.values === "string" ? t.values : String(t.values)),
      touches: parseTouches(t.touches || {}),
    };
    if (t.mutexes) {
      task.mutexes = parseValues(typeof t.mutexes === "string" ? t.mutexes : String(t.mutexes));
    }
    return task;
  });

  return PlanSchema.parse({ metadata, contract, tasks });
}

export function parsePlanFile(path: string): Plan {
  const content = readFileSync(path, "utf-8");
  return parsePlanXml(content);
}
