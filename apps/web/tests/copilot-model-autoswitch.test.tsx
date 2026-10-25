import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CopilotModelBanner } from "../components/copilot/copilot-model-bar";
import {
  reprobeCopilotModels,
  resetCopilotModelsStoreForTests,
  useCopilotModels,
} from "../components/copilot/use-copilot-models";
import {
  CopilotProbeRateLimitError,
  createCopilotApi,
  resetCopilotApiMockSessionsForTests,
  type CopilotApiClient,
} from "../lib/copilot-api";
import { clearCopilotModelsCache } from "../lib/copilot-models-cache";
import {
  ModelProbeReportSchema,
  ModelsListResponseSchema,
  type ModelProbeReport,
  type ModelsListResponse,
} from "../lib/copilot-schema";
import { useAiStore } from "../lib/stores/ai-store";
import { useChartStore } from "../lib/stores/chart-store";
import { useCopilotSessionStore } from "../lib/stores/copilot-session-store";
import healthyJson from "./fixtures/wire/models_response.json";
import fallbackJson from "./fixtures/wire/models_response_default_fallback.json";
import downJson from "./fixtures/wire/models_response_upstream_down.json";
import reportJson from "./fixtures/wire/models_probe_report.json";

const healthy = ModelsListResponseSchema.parse(healthyJson);
const fallback = ModelsListResponseSchema.parse(fallbackJson);
const down = ModelsListResponseSchema.parse(downJson);
const report = ModelProbeReportSchema.parse(reportJson);

type Fake = {
  api: CopilotApiClient;
  setModels: (next: ModelsListResponse) => void;
  runModelProbe: ReturnType<typeof vi.fn>;
};

function fakeApi(initial: ModelsListResponse, probeReport: ModelProbeReport = report): Fake {
  let models = initial;
  const runModelProbe = vi.fn(async () => probeReport);
  const api: CopilotApiClient = {
    ...createCopilotApi({ forceMock: true }),
    fetchModels: async () => models,
    fetchModelProbeReport: async () => probeReport,
    runModelProbe,
  };
  return { api, setModels: (next) => (models = next), runModelProbe };
}

async function seedSession(api: CopilotApiClient, modelId: string): Promise<void> {
  const created = await api.createSession({
    title: "Phiên A",
    model_id: modelId,
    chart: { symbol: "BTCUSDT", interval: "1h", from: 1, to: 2, candle_count: 100 },
  });
  localStorage.setItem("copilot.active_session_id", created.id);
}

describe("model auto-switch and re-probe", () => {
  beforeEach(() => {
    localStorage.clear();
    resetCopilotApiMockSessionsForTests();
    resetCopilotModelsStoreForTests();
    clearCopilotModelsCache();
    useAiStore.setState({ messages: [], inFlight: false, lastError: null });
    useChartStore.setState({ symbol: "BTCUSDT", interval: "1h" });
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
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("switches a saved unhealthy model to default_model on bootstrap and says so", async () => {
    const { api } = fakeApi(healthy);
    await seedSession(api, "openrouter/gpt-5");
    useCopilotSessionStore.getState().setApi(api);
    await useCopilotSessionStore.getState().bootstrap();

    const state = useCopilotSessionStore.getState();
    expect(state.modelId).toBe("agentrouter/deepseek-v4-flash");
    expect(state.modelNotice).toBe(
      'Model "openrouter/gpt-5" không còn khả dụng — đã chuyển sang "agentrouter/deepseek-v4-flash".',
    );
  });

  it("keeps a healthy saved model without a notice", async () => {
    const { api } = fakeApi(healthy);
    await seedSession(api, "agentrouter/glm-4.6");
    useCopilotSessionStore.getState().setApi(api);
    await useCopilotSessionStore.getState().bootstrap();
    expect(useCopilotSessionStore.getState().modelId).toBe("agentrouter/glm-4.6");
    expect(useCopilotSessionStore.getState().modelNotice).toBeNull();
  });

  it("re-probe that drops the selected model switches with the probe reason", async () => {
    const reportDeepseekDown: ModelProbeReport = {
      ...report,
      results: report.results.map((r) =>
        r.id === "agentrouter/deepseek-v4-flash" ? { ...r, status: "auth_error" } : r,
      ),
    };
    const fake = fakeApi(healthy, reportDeepseekDown);
    await seedSession(fake.api, "agentrouter/deepseek-v4-flash");
    useCopilotSessionStore.getState().setApi(fake.api);
    await useCopilotSessionStore.getState().bootstrap();
    expect(useCopilotSessionStore.getState().modelId).toBe("agentrouter/deepseek-v4-flash");

    fake.setModels(fallback);
    await reprobeCopilotModels(fake.api);
    useCopilotSessionStore.getState().reconcileModelWithCatalog();

    const state = useCopilotSessionStore.getState();
    expect(fake.runModelProbe).toHaveBeenCalledTimes(1);
    expect(state.modelId).toBe("agentrouter/glm-4.6");
    expect(state.modelNotice).toContain("(Sai khóa API)");
    expect(state.modelNotice).toContain('"agentrouter/glm-4.6"');
  });

  it("unhealthy-model error refetches models and switches", async () => {
    const fake = fakeApi(healthy);
    await seedSession(fake.api, "agentrouter/deepseek-v4-flash");
    useCopilotSessionStore.getState().setApi(fake.api);
    await useCopilotSessionStore.getState().bootstrap();

    fake.setModels(fallback);
    await useCopilotSessionStore.getState().handleUnhealthyModel();
    expect(useCopilotSessionStore.getState().modelId).toBe("agentrouter/glm-4.6");
    expect(useCopilotSessionStore.getState().modelNotice).toContain("agentrouter/deepseek-v4-flash");
  });

  it("429 blocks re-probe and shows a countdown", async () => {
    const fake = fakeApi(down);
    fake.runModelProbe.mockRejectedValue(new CopilotProbeRateLimitError({}, 42));
    function Harness() {
      useCopilotModels(fake.api);
      return <CopilotModelBanner api={fake.api} />;
    }
    render(<Harness />);
    expect(await screen.findByText("Không kết nối được OmniRoute")).toBeTruthy();
    expect(screen.getByText(/Connection refused/)).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kiểm tra lại" }));
    });
    const button = await screen.findByRole("button", { name: /Thử lại sau 4[12]s/ });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await reprobeCopilotModels(fake.api);
    expect(fake.runModelProbe).toHaveBeenCalledTimes(1);
  });

  it("live client maps 429 Retry-After into CopilotProbeRateLimitError", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "rate_limited", retry_after_s: 9 }), {
          status: 429,
          headers: { "Retry-After": "17", "Content-Type": "application/json" },
        }),
    );
    const api = createCopilotApi({ fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "" });
    const err = await api.runModelProbe().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CopilotProbeRateLimitError);
    expect((err as CopilotProbeRateLimitError).retryAfterS).toBe(17);
    expect(fetchImpl).toHaveBeenCalledWith("/v1/copilot/models/probe", { method: "POST" });
  });

  it("live client returns null when the probe is disabled (409 probe_disabled)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ code: "probe_disabled" }), { status: 409 }),
    );
    const api = createCopilotApi({ fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "" });
    expect(await api.runModelProbe()).toBeNull();
  });

  it("live client returns null when the backend has no probe endpoint", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 }));
    const api = createCopilotApi({ fetchImpl: fetchImpl as unknown as typeof fetch, baseUrl: "" });
    expect(await api.fetchModelProbeReport()).toBeNull();
  });
});
