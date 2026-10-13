import {
  CopilotSessionApiSchema,
  CreateSessionRequestSchema,
  ModelsListResponseSchema,
  SessionsListResponseSchema,
  UpdateSessionRequestSchema,
  type CopilotSessionApi,
  type CreateSessionRequest,
  type CopilotModelRecord,
  type ModelsListResponse,
  type SessionSummary,
  type UpdateSessionRequest,
} from "./copilot-schema";
import { stripReasoningFromTitle } from "./copilot-session-encoding";

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
      id: "cursor/auto",
      label: "cursor-auto",
      provider: "cursor",
      context_window: 128_000,
      max_output_tokens: 8_192,
      supports_reasoning: true,
      reasoning_efforts: ["none"],
      supports_json: true,
      source: "default",
      recommended_candles: 100,
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
  listSessions: () => Promise<{ sessions: SessionSummary[] }>;
  getSession: (sessionId: string) => Promise<CopilotSessionApi>;
  createSession: (body: CreateSessionRequest) => Promise<CopilotSessionApi>;
  updateSession: (sessionId: string, body: UpdateSessionRequest) => Promise<CopilotSessionApi>;
  deleteSession: (sessionId: string) => Promise<{ ok: true }>;
};

type MockSessionsState = {
  sessions: Map<string, CopilotSessionApi>;
};

let mockSessionsState: MockSessionsState | null = null;

function resetMockSessions(): void {
  mockSessionsState = { sessions: new Map() };
}

function mockSessionSummaries(): SessionSummary[] {
  if (!mockSessionsState) resetMockSessions();
  const list = [...mockSessionsState!.sessions.values()].map((s) => {
    return {
      id: s.id,
      title: stripReasoningFromTitle(s.title),
      created_at: s.created_at,
      updated_at: s.updated_at,
      model_id: s.model_id,
      symbol: s.chart.symbol,
      interval: s.chart.interval,
      candle_count: s.chart.candle_count,
      message_count: s.messages.length,
    };
  });
  list.sort((a, b) => b.updated_at - a.updated_at);
  return list.slice(0, 50);
}

function mockCreateSession(body: CreateSessionRequest): CopilotSessionApi {
  if (!mockSessionsState) resetMockSessions();
  const now = Math.floor(Date.now() / 1000);
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `sess_${now}_${Math.random().toString(36).slice(2, 9)}`;
  const parsed = CreateSessionRequestSchema.parse(body);
  const record: CopilotSessionApi = {
    id,
    title: parsed.title,
    created_at: now,
    updated_at: now,
    model_id: parsed.model_id,
    chart: parsed.chart,
    messages: parsed.messages ?? [],
  };
  mockSessionsState!.sessions.set(id, record);
  return record;
}

function mockUpdateSession(sessionId: string, body: UpdateSessionRequest): CopilotSessionApi {
  if (!mockSessionsState) resetMockSessions();
  const existing = mockSessionsState!.sessions.get(sessionId);
  if (!existing) {
    throw new CopilotApiError(404, { error: "session not found" }, "session not found");
  }
  const parsed = UpdateSessionRequestSchema.parse(body);
  const updated: CopilotSessionApi = {
    ...existing,
    title: parsed.title ?? existing.title,
    model_id: parsed.model_id ?? existing.model_id,
    chart: parsed.chart ?? existing.chart,
    messages: parsed.messages ?? existing.messages,
    updated_at: Math.floor(Date.now() / 1000),
  };
  mockSessionsState!.sessions.set(sessionId, updated);
  return updated;
}

function createMockSessionsApi(): Pick<
  CopilotApiClient,
  "listSessions" | "getSession" | "createSession" | "updateSession" | "deleteSession"
> {
  if (!mockSessionsState) resetMockSessions();
  return {
    listSessions: async () => ({ sessions: mockSessionSummaries() }),
    getSession: async (sessionId) => {
      const record = mockSessionsState!.sessions.get(sessionId);
      if (!record) {
        throw new CopilotApiError(404, { error: "session not found" }, "session not found");
      }
      return CopilotSessionApiSchema.parse(record);
    },
    createSession: async (body) => CopilotSessionApiSchema.parse(mockCreateSession(body)),
    updateSession: async (sessionId, body) =>
      CopilotSessionApiSchema.parse(mockUpdateSession(sessionId, body)),
    deleteSession: async (sessionId) => {
      if (!mockSessionsState!.sessions.delete(sessionId)) {
        throw new CopilotApiError(404, { error: "session not found" }, "session not found");
      }
      return { ok: true as const };
    },
  };
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const body = await readErrorBody(res);
    throw new CopilotApiError(res.status, body, fallback);
  }
  return (await res.json()) as T;
}

function createLiveSessionsApi(
  fetchImpl: typeof fetch,
  baseUrl: string,
): Pick<
  CopilotApiClient,
  "listSessions" | "getSession" | "createSession" | "updateSession" | "deleteSession"
> {
  return {
    listSessions: async () => {
      const json = await jsonOrThrow<{ sessions: unknown[] }>(
        await fetchImpl(`${baseUrl}/v1/copilot/sessions`),
        "sessions_list_failed",
      );
      return SessionsListResponseSchema.parse(json);
    },
    getSession: async (sessionId) => {
      const json = await jsonOrThrow<unknown>(
        await fetchImpl(`${baseUrl}/v1/copilot/sessions/${encodeURIComponent(sessionId)}`),
        "session_get_failed",
      );
      return CopilotSessionApiSchema.parse(json);
    },
    createSession: async (body) => {
      const parsed = CreateSessionRequestSchema.parse(body);
      const json = await jsonOrThrow<unknown>(
        await fetchImpl(`${baseUrl}/v1/copilot/sessions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        }),
        "session_create_failed",
      );
      return CopilotSessionApiSchema.parse(json);
    },
    updateSession: async (sessionId, body) => {
      const parsed = UpdateSessionRequestSchema.parse(body);
      const json = await jsonOrThrow<unknown>(
        await fetchImpl(`${baseUrl}/v1/copilot/sessions/${encodeURIComponent(sessionId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        }),
        "session_update_failed",
      );
      return CopilotSessionApiSchema.parse(json);
    },
    deleteSession: async (sessionId) => {
      await jsonOrThrow<{ ok: true }>(
        await fetchImpl(`${baseUrl}/v1/copilot/sessions/${encodeURIComponent(sessionId)}`, {
          method: "DELETE",
        }),
        "session_delete_failed",
      );
      return { ok: true };
    },
  };
}

/** Test-only: clear in-memory mock sessions. */
export function resetCopilotApiMockSessionsForTests(): void {
  resetMockSessions();
}

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

  const sessionsApi = opts.forceMock
    ? createMockSessionsApi()
    : createLiveSessionsApi(fetchImpl, baseUrl);

  if (opts.forceMock) {
    return {
      fetchModels: async () => MOCK_MODELS_RESPONSE,
      ...sessionsApi,
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
    ...sessionsApi,
  };
}

export function findModelById(
  models: CopilotModelRecord[],
  modelId: string | null,
): CopilotModelRecord | null {
  if (!modelId) return null;
  return models.find((m) => m.id === modelId) ?? null;
}
