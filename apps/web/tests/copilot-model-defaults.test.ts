import { describe, expect, it } from "vitest";
import {
  modelIdForAnalyzeRequest,
  resolveCatalogDefaultId,
  resolveDefaultModelId,
  resolveSessionModelId,
} from "../lib/copilot-model-defaults";
import type { CopilotModelRecord } from "../lib/copilot-schema";
import { DEFAULT_CANDLE_COUNT } from "../lib/copilot-model-limits";

function model(id: string, provider = "p"): CopilotModelRecord {
  return {
    id,
    label: id.split("/").pop() ?? id,
    provider,
    context_window: 128_000,
    max_output_tokens: 8_192,
    supports_reasoning: true,
    reasoning_efforts: ["none", "low"],
    supports_json: true,
  };
}

describe("resolveDefaultModelId", () => {
  const alpha = model("provider-a/alpha");
  const beta = model("provider-b/beta");

  it("prefers saved id when still in list", () => {
    expect(resolveDefaultModelId([alpha, beta], alpha.id, beta.id)).toBe(alpha.id);
  });

  it("uses API default_model when saved id is gone", () => {
    expect(resolveDefaultModelId([alpha, beta], "removed/id", beta.id)).toBe(beta.id);
  });

  it("falls back to first model when API default is missing or unknown", () => {
    expect(resolveDefaultModelId([alpha, beta], null, "missing")).toBe(alpha.id);
    expect(resolveDefaultModelId([beta], null, null)).toBe(beta.id);
  });

  it("returns null when catalog is empty", () => {
    expect(resolveDefaultModelId([], "saved", "api")).toBeNull();
    expect(resolveSessionModelId([], "", null)).toBeNull();
    expect(modelIdForAnalyzeRequest([], "saved", null)).toBeUndefined();
  });

  it("resolveCatalogDefaultId has no hard-coded ids", () => {
    expect(resolveCatalogDefaultId([beta], alpha.id)).toBe(beta.id);
    expect(resolveCatalogDefaultId([], "any")).toBeNull();
  });
});

describe("default candle count", () => {
  it("is 100", () => {
    expect(DEFAULT_CANDLE_COUNT).toBe(100);
  });
});
