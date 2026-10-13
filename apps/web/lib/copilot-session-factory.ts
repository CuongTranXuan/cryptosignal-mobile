import { DEFAULT_CANDLE_COUNT } from "./copilot-model-limits";
import type { CopilotSessionV1 } from "./copilot-schema";

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function newLocalSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `sess_${crypto.randomUUID()}`;
  }
  return `sess_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export function buildEmptyClientSession(
  modelId: string,
  title = "Phiên mới",
  reasoningEffort: string | null = null,
): CopilotSessionV1 {
  const t = nowSec();
  return {
    id: newLocalSessionId(),
    title,
    created_at: t,
    updated_at: t,
    model_id: modelId,
    reasoning_effort: reasoningEffort,
    chart: {
      symbol: "BTCUSDT",
      interval: "1h",
      from: 0,
      to: 0,
      candle_count: DEFAULT_CANDLE_COUNT,
    },
    messages: [],
  };
}
