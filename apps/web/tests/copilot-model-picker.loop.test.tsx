import { render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CopilotModelPicker } from "../components/copilot/copilot-model-picker";
import {
  resetCopilotModelsStoreForTests,
  syncModelsSnapshotFromCache,
} from "../components/copilot/use-copilot-models";
import { createCopilotApi, MOCK_MODELS_RESPONSE } from "../lib/copilot-api";
import { clearCopilotModelsCache } from "../lib/copilot-models-cache";

describe("CopilotModelPicker render loop", () => {
  afterEach(() => {
    clearCopilotModelsCache();
    resetCopilotModelsStoreForTests();
    vi.restoreAllMocks();
  });

  it("does not spin re-renders when models are already cached", async () => {
    const api = createCopilotApi({ forceMock: true });
    await api.fetchModels();
    syncModelsSnapshotFromCache();

    const renderSpy = vi.fn();
    function Probe() {
      renderSpy();
      return (
        <CopilotModelPicker
          api={api}
          selectedModelId={MOCK_MODELS_RESPONSE.default_model}
          onSelect={() => undefined}
        />
      );
    }

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<Probe />);

    await waitFor(() => {
      expect(renderSpy.mock.calls.length).toBeLessThan(25);
    });

    const setStateInRender = consoleError.mock.calls.some((args) =>
      String(args[0] ?? "").includes("Cannot update a component"),
    );
    expect(setStateInRender).toBe(false);
    consoleError.mockRestore();
  });
});
