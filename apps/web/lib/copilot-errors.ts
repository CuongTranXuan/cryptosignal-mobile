import type { ApiErrorBody } from "./copilot-api";
import { CopilotErrorEventSchema } from "./copilot-schema";
import {
  COPILOT_ERROR,
  COPILOT_ERROR_CANDLE_COUNT,
  COPILOT_ERROR_EMPTY_OUTPUT,
  COPILOT_ERROR_MODELS_UNAVAILABLE,
  COPILOT_ERROR_OVER_BUDGET,
  COPILOT_ERROR_CREDITS_EXHAUSTED,
  COPILOT_ERROR_INVALID_MODEL,
  COPILOT_ERROR_RATE_LIMITED,
  COPILOT_ERROR_UNAUTHORIZED,
  mapCopilotSseError,
} from "./copilot-strings";

function normalizeCode(code: string | null | undefined): string {
  return (code ?? "").trim().toLowerCase().replace(/\s+/g, "_");
}

export function mapCopilotErrorCode(code: string, messageVi: string): string {
  const normalized = normalizeCode(code);
  switch (normalized) {
    case "unknown_model":
      return COPILOT_ERROR_INVALID_MODEL;
    case "over_budget":
      return COPILOT_ERROR_OVER_BUDGET;
    case "empty_model_output":
      return COPILOT_ERROR_EMPTY_OUTPUT;
    case "models_unavailable":
      return COPILOT_ERROR_MODELS_UNAVAILABLE;
    case "provider_error":
      return messageVi.trim() ? mapCopilotSseError(messageVi) : COPILOT_ERROR;
    default:
      return messageVi.trim() ? mapCopilotSseError(messageVi) : COPILOT_ERROR;
  }
}

export function mapCopilotSseErrorPayload(data: Record<string, unknown>): string {
  const parsed = CopilotErrorEventSchema.safeParse(data);
  if (parsed.success) {
    return mapCopilotErrorCode(parsed.data.code, parsed.data.message);
  }
  const message = typeof data.message === "string" ? data.message : "";
  const code = typeof data.code === "string" ? data.code : null;
  if (code) return mapCopilotErrorCode(code, message);
  return message.trim() ? mapCopilotSseError(message) : COPILOT_ERROR;
}

export function mapCopilotHttpError(status: number, body: ApiErrorBody): string {
  const code = normalizeCode(body.code ?? (typeof body.error === "string" ? body.error : null));
  const message = typeof body.message === "string" ? body.message : "";

  if (status === 401 || status === 403) return COPILOT_ERROR_UNAUTHORIZED;
  if (status === 402) return COPILOT_ERROR_CREDITS_EXHAUSTED;
  if (status === 429) return COPILOT_ERROR_RATE_LIMITED;

  if (code) {
    return mapCopilotErrorCode(code, message);
  }

  if (message.trim()) {
    return mapCopilotSseError(message);
  }
  return COPILOT_ERROR;
}
