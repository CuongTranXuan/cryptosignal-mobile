import { describe, expect, it } from "vitest";
import {
  formatProbedAt,
  hiddenModelsFromReport,
  modelSwitchedFrom,
  nextModelsRefetchDelayMs,
  parseRetryAfterSeconds,
  probeDetailLine,
  probeReasonForModel,
  probeStatusLabel,
  retryCountdownSeconds,
  unhealthyModelFromError,
} from "../lib/copilot-model-probe";
import { ModelProbeReportSchema, ModelsListResponseSchema } from "../lib/copilot-schema";
import healthyJson from "./fixtures/wire/models_response.json";
import reportJson from "./fixtures/wire/models_probe_report.json";

const healthy = ModelsListResponseSchema.parse(healthyJson);
const report = ModelProbeReportSchema.parse(reportJson);

describe("probe reason mapping", () => {
  it("maps every failure status to Vietnamese", () => {
    expect(probeStatusLabel("auth_error")).toBe("Sai khóa API");
    expect(probeStatusLabel("quota_or_rate_limited")).toBe("Hết hạn mức / bị giới hạn");
    expect(probeStatusLabel("not_found")).toBe("Không tìm thấy model");
    expect(probeStatusLabel("timeout")).toBe("Hết thời gian chờ");
    expect(probeStatusLabel("upstream_error")).toBe("Lỗi máy chủ upstream");
    expect(probeStatusLabel("something_new")).toBe("Không khả dụng");
  });

  it("lists hidden models with latency, HTTP status and message", () => {
    const hidden = hiddenModelsFromReport(report);
    expect(hidden.map((r) => r.id)).not.toContain("agentrouter/deepseek-v4-flash");
    expect(probeDetailLine(hidden[0]!)).toBe("180 ms · HTTP 401 · Invalid API key");
    expect(probeDetailLine({ id: "a", status: "timeout" })).toBe("");
    expect(hiddenModelsFromReport(null)).toEqual([]);
    expect(probeReasonForModel(report, "openrouter/gpt-5")).toBe("Hết hạn mức / bị giới hạn");
    expect(probeReasonForModel(report, "agentrouter/glm-4.6")).toBeUndefined();
  });
});

describe("formatProbedAt", () => {
  it("shows local clock time and a Vietnamese relative age", () => {
    const at = new Date(2026, 9, 25, 11, 42, 0);
    const iso = at.toISOString();
    expect(formatProbedAt(iso, at.getTime() + 20_000)).toBe("Kiểm tra lúc 11:42 · vừa xong");
    expect(formatProbedAt(iso, at.getTime() + 3 * 60_000)).toBe("Kiểm tra lúc 11:42 · 3 phút trước");
    expect(formatProbedAt(iso, at.getTime() + 2 * 3_600_000)).toBe("Kiểm tra lúc 11:42 · 2 giờ trước");
    expect(formatProbedAt(null, Date.now())).toBe("Chưa kiểm tra model");
  });
});

describe("429 retry-after", () => {
  it("prefers the header, then retry_after_s, then 30s", () => {
    expect(parseRetryAfterSeconds("42", { retry_after_s: 5 })).toBe(42);
    expect(parseRetryAfterSeconds(null, { retry_after_s: 12.2 })).toBe(13);
    expect(parseRetryAfterSeconds(null, { detail: { retry_after_s: 7 } })).toBe(7);
    expect(parseRetryAfterSeconds(null, {})).toBe(30);
    expect(parseRetryAfterSeconds("99999", null)).toBe(600);
    const now = Date.parse("2026-10-25T04:42:00Z");
    expect(parseRetryAfterSeconds("Sun, 25 Oct 2026 04:42:20 GMT", null, now)).toBe(20);
  });

  it("counts down to zero", () => {
    expect(retryCountdownSeconds(10_000, 0)).toBe(10);
    expect(retryCountdownSeconds(10_000, 9_001)).toBe(1);
    expect(retryCountdownSeconds(10_000, 12_000)).toBe(0);
    expect(retryCountdownSeconds(null, 0)).toBe(0);
  });
});

describe("nextModelsRefetchDelayMs", () => {
  const probedAt = Date.parse(healthy.probed_at!);

  it("waits for the server TTL, never under 30s", () => {
    expect(nextModelsRefetchDelayMs(healthy, probedAt)).toBe(600_000);
    expect(nextModelsRefetchDelayMs(healthy, probedAt + 590_000)).toBe(30_000);
  });

  it("polls gently while stale or probing, and not at all for legacy backends", () => {
    expect(nextModelsRefetchDelayMs({ ...healthy, probe_in_progress: true }, probedAt)).toBe(10_000);
    expect(nextModelsRefetchDelayMs({ ...healthy, stale: true }, probedAt)).toBe(30_000);
    const { probed_at: _ignored, ...legacy } = healthy;
    expect(nextModelsRefetchDelayMs(legacy, probedAt)).toBeNull();
    expect(nextModelsRefetchDelayMs(null, probedAt)).toBeNull();
  });
});

describe("auto-switch helpers", () => {
  it("names the saved model only when it left the healthy list", () => {
    const models = healthy.models;
    expect(modelSwitchedFrom(models, "openrouter/gpt-5", "agentrouter/deepseek-v4-flash")).toBe(
      "openrouter/gpt-5",
    );
    expect(modelSwitchedFrom(models, "agentrouter/glm-4.6", "agentrouter/glm-4.6")).toBeNull();
    expect(modelSwitchedFrom(models, null, "agentrouter/glm-4.6")).toBeNull();
    expect(modelSwitchedFrom([], "openrouter/gpt-5", null)).toBeNull();
  });

  it("detects unhealthy-model 4xx at top level or under FastAPI detail", () => {
    expect(unhealthyModelFromError(409, { code: "model_unhealthy", probe_status: "timeout" })).toEqual({
      status: "timeout",
    });
    expect(unhealthyModelFromError(422, { detail: { probe: { status: "auth_error" } } })).toEqual({
      status: "auth_error",
    });
    expect(
      unhealthyModelFromError(422, {
        code: "model_unavailable",
        message: "Mô hình hiện không phản hồi — chọn mô hình khác",
        detail: "agentrouter/deepseek-v4-flash: probe status quota_or_rate_limited",
      }),
    ).toEqual({ status: "quota_or_rate_limited" });
    expect(unhealthyModelFromError(400, { code: "unknown_model" })).toEqual({ status: null });
    expect(unhealthyModelFromError(429, { probe_status: "timeout" })).toBeNull();
    expect(unhealthyModelFromError(502, { probe_status: "timeout" })).toBeNull();
    expect(unhealthyModelFromError(400, { code: "invalid_intent" })).toBeNull();
  });
});
