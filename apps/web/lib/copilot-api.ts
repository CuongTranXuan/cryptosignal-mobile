import {
  ModelsListResponseSchema,
  type CopilotModelRecord,
  type ModelsListResponse,
} from "./copilot-schema";

export type { CopilotModelRecord, ModelsListResponse } from "./copilot-schema";

const DEFAULT_BASE = "";

export function resolveCopilotBaseUrl(explicit?: string): string {
  if (explicit !== undefined) return explicit.replace(/\/$/, "");
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
    ?.env;
  const fromEnv = env?.NEXT_PUBLIC_COPILOT_URL;
  if (fromEnv === undefined || fromEnv === null || fromEnv.trim() === "") {
    return DEFAULT_BASE;
  }
  return fromEnv.replace(/\/$/, "");
}

export type ApiErrorBody = {
  error?: string;
  code?: string;
  message?: string;
  detail?: unknown;
};

export class CopilotApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: ApiErrorBody;

  constructor(status: number, body: ApiErrorBody, fallbackMessage: string) {
    const code =
      typeof body.code === "string"
        ? body.code
        : typeof body.error === "string"
          ? body.error
          : null;
    const message =
      typeof body.message === "string" && body.message.trim()
        ? body.message
        : fallbackMessage;
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function readErrorBody(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return {};
  }
}

export const MOCK_MODELS_RESPONSE: ModelsListResponse = {
  default_model: "agentrouter/deepseek-v4-flash",
  fetched_at: 1_791_843_996,
  models: [
    {
      id: "agentrouter/deepseek-v4-flash",
      label: "deepseek-v4-flash",
      provider: "agentrouter",
      context_window: 1_000_000,
      max_output_tokens: 384_000,
      supports_reasoning: true,
      reasoning_efforts: ["none", "low", "medium", "high"],
      supports_json: true,
      source: "provider",
      request_max_tokens: 16_384,
      recommended_candles: 200,
      recommended_max_candles: 500,
      presets: [50, 100, 150, 200, 300, 500],
    },
    {
      id: "auto/combo-fast",
      label: "combo-fast",
      provider: "combo",
      context_window: 128_000,
      max_output_tokens: 8_192,
      supports_reasoning: true,
      reasoning_efforts: [],
      supports_json: true,
      source: "default",
      recommended_candles: 200,
      recommended_max_candles: 300,
      presets: [50, 100, 150, 200, 300, 500],
    },
  ],
};

export type CopilotApiClient = {
  fetchModels: (query?: string) => Promise<ModelsListResponse>;
};

export type CreateCopilotApiOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  forceMock?: boolean;
  fallbackMockOnMissing?: boolean;
};

export function createCopilotApi(opts: CreateCopilotApiOptions = {}): CopilotApiClient {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = resolveCopilotBaseUrl(opts.baseUrl);
  const fallbackMock = opts.fallbackMockOnMissing ?? true;

  if (opts.forceMock) {
    return {
      fetchModels: async () => MOCK_MODELS_RESPONSE,
    };
  }

  return {
    fetchModels: async (query?: string) => {
      const qs = query?.trim() ? `?q=${encodeURIComponent(query.trim())}` : "";
      const res = await fetchImpl(`${baseUrl}/v1/copilot/models${qs}`);
      if (res.status === 404 && fallbackMock) {
        return MOCK_MODELS_RESPONSE;
      }
      if (!res.ok) {
        const body = await readErrorBody(res);
        throw new CopilotApiError(res.status, body, "models_fetch_failed");
      }
      const json = await res.json();
      return ModelsListResponseSchema.parse(json);
    },
  };
}

export function findModelById(
  models: CopilotModelRecord[],
  modelId: string | null,
): CopilotModelRecord | null {
  if (!modelId) return null;
  return models.find((m) => m.id === modelId) ?? null;
}
