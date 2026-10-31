import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCopilotApi, MOCK_MODELS_RESPONSE } from "../lib/copilot-api";
import {
  MODELS_CACHE_TTL_MS,
  clearCopilotModelsCache,
  loadCopilotModels,
} from "../lib/copilot-models-cache";

describe("copilot models cache", () => {
  beforeEach(() => {
    clearCopilotModelsCache();
    vi.restoreAllMocks();
  });

  it("dedupes fetch and honors TTL", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => MOCK_MODELS_RESPONSE,
    }));
    const api = createCopilotApi({
      fetchImpl: fetchMock as unknown as typeof fetch,
      fallbackMockOnMissing: false,
    });
    const first = await loadCopilotModels(api);
    const second = await loadCopilotModels(api);
    expect(first.models.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(MODELS_CACHE_TTL_MS).toBe(10 * 60 * 1000);
  });
});
