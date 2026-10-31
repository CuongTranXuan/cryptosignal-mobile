import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AnalysisSseEventSchema,
  AnalyzeMetaEventSchema,
  RegimeSseEventSchema,
} from "../lib/copilot-schema";
import { PatternShapeSchema } from "../lib/pattern-shape";
import { coerceAgentShape } from "../lib/normalize-agent-shape";

function parseSseBlocks(raw: string): { event: string; data: string }[] {
  const events: { event: string; data: string }[] = [];
  for (const part of raw.split("\n\n")) {
    if (!part.trim()) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of part.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    events.push({ event, data: dataLines.join("\n") });
  }
  return events;
}

describe("e2e SSE wire validation", () => {
  it("parses captured analyze SSE with client schemas", () => {
    const path = process.env.E2E_SSE_FILE;
    if (!path) return;
    const text = readFileSync(path, "utf8");
    const rejected: unknown[] = [];
    for (const { event, data } of parseSseBlocks(text)) {
      if (!data) continue;
      const payload = JSON.parse(data) as Record<string, unknown>;
      switch (event) {
        case "meta": {
          const parsed = AnalyzeMetaEventSchema.safeParse(payload);
          if (!parsed.success) rejected.push({ event, payload, issues: parsed.error.issues });
          break;
        }
        case "regime": {
          const parsed = RegimeSseEventSchema.safeParse(payload);
          if (!parsed.success) rejected.push({ event, payload, issues: parsed.error.issues });
          break;
        }
        case "analysis": {
          const parsed = AnalysisSseEventSchema.safeParse(payload);
          if (!parsed.success) rejected.push({ event, payload, issues: parsed.error.issues });
          break;
        }
        case "shapes": {
          const list = Array.isArray(payload.shapes) ? payload.shapes : [];
          for (const item of list) {
            const coerced = coerceAgentShape(item, { symbol: "BTCUSDT", interval: "1h" });
            const parsed = PatternShapeSchema.safeParse(coerced);
            if (!parsed.success) rejected.push({ event: "shapes.shape", payload: item, issues: parsed.error.issues });
          }
          break;
        }
        default:
          break;
      }
    }
    if (rejected.length > 0) {
      console.error(JSON.stringify(rejected, null, 2));
    }
    expect(rejected).toEqual([]);
  });
});
