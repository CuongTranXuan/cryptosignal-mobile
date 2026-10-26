import { beforeEach, describe, expect, it } from "vitest";
import {
  refreshCopilotModels,
  resetCopilotModelsStoreForTests,
} from "../components/copilot/use-copilot-models";
import {
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
  type CopilotApiClient,
} from "../lib/copilot-api";
import {
  formatProbeProgress,
  isProbeIncomplete,
  modelsAvailability,
  nextModelsRefetchDelayMs,
  probeDetailLine,
  probeStatusLabel,
  resolveModelDuringProbe,
  unhealthyModelFromError,
} from "../lib/copilot-model-probe";
import { clearCopilotModelsCache } from "../lib/copilot-models-cache";
import {
  ModelProbeReportSchema,
  ModelsListResponseSchema,
  type ModelProbeReport,
  type ModelsListResponse,
} from "../lib/copilot-schema";
import { useAiStore } from "../lib/stores/ai-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import unavailableJson from "./fixtures/wire/analyze_model_unavailable.json";
import reportV2Json from "./fixtures/wire/models_probe_report_v2.json";
import healthyJson from "./fixtures/wire/models_response.json";
import fallbackJson from "./fixtures/wire/models_response_default_fallback.json";

const healthy = ModelsListResponseSchema.parse(healthyJson);
const fallback = ModelsListResponseSchema.parse(fallbackJson);
const reportV2 = ModelProbeReportSchema.parse(reportV2Json.healthy);

const partialReport: ModelProbeReport = {
  ...reportV2,
  complete: false,
  probe_in_progress: true,
  results: reportV2.results.slice(0, 2),
};

describe("probe report v2 fields", () => {
  it("parses skipped_ids, complete and probe_in_progress", () => {
    expect(reportV2.complete).toBe(true);
    expect(reportV2.skipped_ids).toEqual([]);
    expect(reportV2.skipped_count).toBe(0);
    expect(reportV2.probe_in_progress).toBe(false);
  });

  it("labels provider_unconfigured and shows its message as detail", () => {
    const hit = reportV2.results.find((r) => r.status === "provider_unconfigured")!;
    expect(probeStatusLabel(hit.status)).toBe("Chưa cấu hình nhà cung cấp");
    expect(probeDetailLine(hit)).toBe(
      "850 ms · HTTP 502 · Auggie CLI not found. Please install/login first.",
    );
  });

  it("detects an incomplete probe from /models or the report", () => {
    expect(isProbeIncomplete(healthy, reportV2)).toBe(false);
    expect(isProbeIncomplete({ ...healthy, probe_in_progress: true }, null)).toBe(true);
    expect(isProbeIncomplete(healthy, partialReport)).toBe(true);
  });

  it("formats progress as N/M when the total is known, else N done", () => {
    expect(formatProbeProgress(partialReport, 4)).toBe("Đang kiểm tra… (2/4)");
    expect(formatProbeProgress(partialReport)).toBe("Đang kiểm tra… (đã xong 2)");
    expect(formatProbeProgress({ ...partialReport, results: [] })).toBe("Đang kiểm tra…");
  });

  it("treats an empty partial list as probing, not as no models", () => {
    const empty: ModelsListResponse = { ...healthy, models: [], probe_in_progress: true };
    expect(modelsAvailability(empty, partialReport)).toBe("probing");
    expect(modelsAvailability({ ...empty, probe_in_progress: false }, reportV2)).toBe("empty");
    expect(nextModelsRefetchDelayMs(healthy, Date.now(), partialReport)).toBe(10_000);
  });

  it("keeps the saved model while incomplete", () => {
    expect(resolveModelDuringProbe("a/b", true, () => "c/d")).toBe("a/b");
    expect(resolveModelDuringProbe("a/b", false, () => "c/d")).toBe("c/d");
    expect(resolveModelDuringProbe(null, true, () => "c/d")).toBe("c/d");
  });
});

describe("422 model_unavailable", () => {
  it("reads the structured probe_status", () => {
    expect(unhealthyModelFromError(422, unavailableJson)).toEqual({
      status: "quota_or_rate_limited",
    });
  });

  it("falls back to parsing detail", () => {
    expect(
      unhealthyModelFromError(422, { code: "model_unavailable", detail: "m/x: probe status timeout" }),
    ).toEqual({ status: "timeout" });
  });
});

describe("no auto-switch until the probe is complete", () => {
  let models: ModelsListResponse;
  let report: ModelProbeReport;
  let api: CopilotApiClient;

  beforeEach(async () => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
    resetCopilotModelsStoreForTests();
    clearCopilotModelsCache();
    useAiStore.setState({ messages: [], inFlight: false, lastError: null });
    useCopilotSessionStore.setState({
      api: null,
      sessions: [],
      activeSessionId: null,
      modelId: null,
      modelNotice: null,
      sessionCache: {},
      sessionsError: null,
      sessionsDirty: false,
    });
    models = healthy;
    report = reportV2;
    api = {
      ...createCopilotApi({ forceMock: true }),
      fetchModels: async () => models,
      fetchModelProbeReport: async () => report,
    };
    const created = await api.createSession({
      title: "Phiên A",
      model_id: "agentrouter/deepseek-v4-flash",
      chart: { symbol: "BTCUSDT", interval: "1h", from: 1, to: 2, candle_count: 100 },
    });
    localStorage.setItem("copilot.active_session_id", created.id);
    useCopilotSessionStore.getState().setApi(api);
    await useCopilotSessionStore.getState().bootstrap();
  });

  it("keeps the selected model during a partial probe, then switches once complete", async () => {
    expect(useCopilotSessionStore.getState().modelId).toBe("agentrouter/deepseek-v4-flash");

    models = { ...fallback, probe_in_progress: true };
    report = partialReport;
    await refreshCopilotModels(api);
    useCopilotSessionStore.getState().reconcileModelWithCatalog();
    expect(useCopilotSessionStore.getState().modelId).toBe("agentrouter/deepseek-v4-flash");
    expect(useCopilotSessionStore.getState().modelNotice).toBeNull();

    models = { ...fallback, probe_in_progress: false };
    report = ModelProbeReportSchema.parse(reportV2Json.default_fallback);
    await refreshCopilotModels(api);
    useCopilotSessionStore.getState().reconcileModelWithCatalog();
    const state = useCopilotSessionStore.getState();
    expect(state.modelId).not.toBe("agentrouter/deepseek-v4-flash");
    expect(state.modelNotice).toContain("(Sai khóa API)");
  });
});
