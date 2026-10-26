import { describe, expect, it } from "vitest";
import { AnalysisSseEventSchema } from "../lib/copilot-schema";
import { mapCopilotHttpError } from "../lib/copilot-errors";
import { upstreamErrorLabel } from "../lib/copilot-model-probe";
import { COPILOT_ERROR_UPSTREAM_UNREACHABLE } from "../lib/copilot-strings";
import { evidenceTexts, preferEvidenceItems } from "../lib/vi-evidence";

describe("phase-2 wire additions", () => {
  it("prefers evidence_*_items over the legacy string arrays", () => {
    const parsed = AnalysisSseEventSchema.parse({
      bias: "bullish",
      evidence_for: ["legacy for"],
      evidence_against: ["legacy against"],
      evidence_for_items: [{ code: "x", params: {}, text: "Giá trên EMA200" }],
      evidence_against_items: [],
    });
    expect(evidenceTexts(preferEvidenceItems(parsed.evidence_for_items, parsed.evidence_for))).toEqual([
      "Giá trên EMA200",
    ]);
    // Empty *_items falls back to the legacy array.
    expect(preferEvidenceItems(parsed.evidence_against_items, parsed.evidence_against)).toEqual([
      "legacy against",
    ]);
  });

  it("503 upstream_unreachable shows the backend's Vietnamese message", () => {
    const body = {
      code: "upstream_unreachable",
      message: "Không kết nối được OmniRoute — thử lại sau.",
      detail: "Upstream unreachable (connection failed)",
    };
    expect(mapCopilotHttpError(503, body)).toBe(body.message);
    expect(mapCopilotHttpError(503, { code: "upstream_unreachable", message: "" })).toBe(
      COPILOT_ERROR_UPSTREAM_UNREACHABLE,
    );
  });

  it("maps every upstream_error.code to Vietnamese (raw English detail is secondary)", () => {
    for (const code of [
      "connect_error",
      "timeout",
      "auth_error",
      "quota_or_rate_limited",
      "http_error",
      "network_error",
      "invalid_response",
      "upstream_error",
      "probe_error",
    ]) {
      const label = upstreamErrorLabel(code);
      expect(label, code).toBeTruthy();
      expect(label, code).not.toMatch(/unreachable|connection failed|error/i);
    }
    expect(upstreamErrorLabel(null)).toBeNull();
    expect(upstreamErrorLabel("something_new")).toBe("lỗi không xác định");
  });
});
