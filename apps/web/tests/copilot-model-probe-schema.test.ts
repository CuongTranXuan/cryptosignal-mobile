import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MOCK_MODELS_RESPONSE } from "../lib/copilot-api";
import { isProbeSupported, modelsAvailability } from "../lib/copilot-model-probe";
import { ModelProbeReportSchema, ModelsListResponseSchema } from "../lib/copilot-schema";
import healthy from "./fixtures/wire/models_response.json";
import fallback from "./fixtures/wire/models_response_default_fallback.json";
import down from "./fixtures/wire/models_response_upstream_down.json";
import empty from "./fixtures/wire/models_response_empty.json";
import report from "./fixtures/wire/models_probe_report.json";

const backendWire = path.resolve(__dirname, "../../copilot/tests/fixtures/wire");
const readBackend = (name: string) =>
  JSON.parse(readFileSync(path.join(backendWire, name), "utf8")) as Record<string, unknown>;

describe("backend wire fixtures (apps/copilot)", () => {
  it("parses every /models state the backend emits", () => {
    const states = readBackend("models_response.json");
    expect(Object.keys(states).sort()).toEqual(["default_fallback", "healthy", "upstream_down"]);
    const parsed = Object.fromEntries(
      Object.entries(states).map(([k, v]) => [k, ModelsListResponseSchema.parse(v)]),
    );
    expect(modelsAvailability(parsed.healthy!)).toBe("healthy");
    expect(parsed.default_fallback!.default_fallback).toBe(true);
    expect(modelsAvailability(parsed.upstream_down!)).toBe("down");
    expect(parsed.upstream_down!.fetched_at).toBeNull();
  });

  it("parses every probe report state", () => {
    for (const report of Object.values(readBackend("models_probe_report.json"))) {
      expect(() => ModelProbeReportSchema.parse(report)).not.toThrow();
    }
  });
});

describe("models probe wire schema", () => {
  it("parses a healthy probed response", () => {
    const parsed = ModelsListResponseSchema.parse(healthy);
    expect(parsed.models.map((m) => m.status)).toEqual(["ok", "ok", "ok"]);
    expect(parsed.models[0]?.latency_ms).toBe(412);
    expect(parsed.default_fallback).toBe(false);
    expect(parsed.ttl_s).toBe(600);
    expect(isProbeSupported(parsed)).toBe(true);
    expect(modelsAvailability(parsed)).toBe("healthy");
  });

  it("parses default_fallback with the requested default", () => {
    const parsed = ModelsListResponseSchema.parse(fallback);
    expect(parsed.default_fallback).toBe(true);
    expect(parsed.requested_default).toBe("agentrouter/deepseek-v4-flash");
    expect(parsed.default_model).toBe("agentrouter/glm-4.6");
  });

  it("parses upstream down with null default and an error message", () => {
    const parsed = ModelsListResponseSchema.parse(down);
    expect(parsed.models).toEqual([]);
    expect(parsed.default_model).toBeNull();
    expect(parsed.upstream_error?.message).toContain("Connection refused");
    expect(modelsAvailability(parsed)).toBe("down");
  });

  it("treats reachable upstream with no healthy model as empty", () => {
    expect(modelsAvailability(ModelsListResponseSchema.parse(empty))).toBe("empty");
  });

  it("accepts a legacy response without probe fields as unknown probe state", () => {
    const { fetched_at, default_model, models } = MOCK_MODELS_RESPONSE;
    const parsed = ModelsListResponseSchema.parse({ fetched_at, default_model, models });
    expect(isProbeSupported(parsed)).toBe(false);
    expect(parsed.stale).toBeUndefined();
    expect(modelsAvailability(parsed)).toBe("healthy");
    expect(modelsAvailability(null)).toBe("unknown");
  });

  it("parses the probe report and keeps unknown statuses", () => {
    const parsed = ModelProbeReportSchema.parse(report);
    expect(parsed.provider).toBe("omniroute");
    expect(parsed.results.filter((r) => r.status !== "ok")).toHaveLength(5);
    const future = ModelProbeReportSchema.parse({
      probed_at: null,
      results: [{ id: "x/y", status: "brand_new_status" }],
    });
    expect(future.results[0]?.status).toBe("brand_new_status");
  });
});
