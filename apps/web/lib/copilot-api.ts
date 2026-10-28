import {
  CopilotSessionApiSchema,
  CreateSessionRequestSchema,
  FeedbackRequestSchema,
  FeedbackResponseSchema,
  ModelProbeReportSchema,
  ModelsListResponseSchema,
  SessionsListResponseSchema,
  StylesListResponseSchema,
  UpdateSessionRequestSchema,
  type CopilotSessionApi,
  type CreateSessionRequest,
  type CopilotModelRecord,
  type FeedbackRequest,
  type ModelProbeReport,
  type ModelsListResponse,
  type SessionSummary,
  type StylesListResponse,
  type UpdateSessionRequest,
} from "./copilot-schema";
import { withCopilotCredentials } from "./copilot-fetch";
import { parseRetryAfterSeconds } from "./copilot-model-probe";
import { stripLegacyReasoningFromTitle } from "./copilot-session-legacy-title";

export type { CopilotModelRecord, ModelProbeReport, ModelsListResponse } from "./copilot-schema";

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

/**
 * 404 `session_not_found` (also the older `{"error": "session not found"}`): the session was
 * deleted or belongs to another device (`csm_device` cookie). Never retried.
 */
export function isSessionGoneBody(status: number, body: ApiErrorBody | null | undefined): boolean {
  if (status !== 404 || !body) return false;
  const raw = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : "";
  return raw.trim().toLowerCase().replace(/\s+/g, "_") === "session_not_found";
}

export function isSessionGoneError(err: unknown): boolean {
  return err instanceof CopilotApiError && isSessionGoneBody(err.status, err.body);
}

/**
 * `Retry-After` (delta seconds or an HTTP date) in ms, or null when absent/invalid.
 * The backend sends `Retry-After: 5` on 503 db_unavailable.
 */
export function retryAfterHeaderMs(header: string | null | undefined, now: number = Date.now()): number | null {
  const raw = header?.trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000);
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export class CopilotApiError extends Error {
  readonly status: number;
  readonly code: string | null;
  readonly body: ApiErrorBody;
  /** From the response's `Retry-After` header (ms), when it had one. */
  readonly retryAfterMs: number | null;

  constructor(status: number, body: ApiErrorBody, fallbackMessage: string, retryAfterMs: number | null = null) {
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
    this.retryAfterMs = retryAfterMs;
  }
}

/** 429 from `POST /models/probe`; `retryAfterS` comes from Retry-After or `retry_after_s`. */
export class CopilotProbeRateLimitError extends CopilotApiError {
  readonly retryAfterS: number;

  constructor(body: ApiErrorBody, retryAfterS: number) {
    super(429, body, "probe_rate_limited");
    this.retryAfterS = retryAfterS;
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
  default_model: "provider-a/model-alpha",
  fetched_at: 1_791_843_996,
  models: [
    {
      id: "provider-a/model-alpha",
      label: "model-alpha",
      provider: "provider-a",
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
      id: "provider-b/auto-route",
      label: "auto-route",
      provider: "provider-b",
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
      id: "combo/fast",
      label: "fast",
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

/** Mirrors backend `list_styles_payload()` (elliott/wyckoff have no detectors yet). */
export const MOCK_STYLES_RESPONSE: StylesListResponse = {
  styles: [
    {
      id: "classic",
      patterns: [
        { id: "ascending_triangle" },
        { id: "descending_triangle" },
        { id: "symmetrical_triangle" },
        { id: "head_and_shoulders" },
        { id: "inverse_head_and_shoulders" },
        { id: "double_top" },
        { id: "double_bottom" },
        { id: "channel_up" },
        { id: "channel_down" },
        { id: "trendline" },
        { id: "support_resistance" },
        { id: "fib_retracement" },
      ],
    },
    {
      id: "smc",
      patterns: [
        { id: "bos" },
        { id: "choch" },
        { id: "fvg" },
        { id: "order_block" },
        { id: "liquidity" },
      ],
    },
    { id: "elliott", patterns: [] },
    { id: "wyckoff", patterns: [] },
  ],
};

let mockFeedbackSeq = 0;

export type CopilotApiClient = {
  fetchModels: (query?: string) => Promise<ModelsListResponse>;
  /** `null` when the backend has no probe endpoint (older copilot). */
  fetchModelProbeReport: () => Promise<ModelProbeReport | null>;
  /** Forces a fresh OmniRoute probe; `null` when the backend has no probe endpoint. */
  runModelProbe: () => Promise<ModelProbeReport | null>;
  fetchStyles: () => Promise<StylesListResponse>;
  submitFeedback: (body: FeedbackRequest) => Promise<{ id: string }>;
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
      title: stripLegacyReasoningFromTitle(s.title),
      created_at: s.created_at,
      updated_at: s.updated_at,
      model_id: s.model_id,
      reasoning_effort: s.reasoning_effort ?? null,
      intent: s.intent ?? null,
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
    reasoning_effort: parsed.reasoning_effort ?? null,
    intent: parsed.intent ?? null,
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
    reasoning_effort:
      parsed.reasoning_effort !== undefined ? parsed.reasoning_effort : existing.reasoning_effort,
    intent: parsed.intent !== undefined ? parsed.intent : existing.intent,
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
    throw new CopilotApiError(res.status, body, fallback, retryAfterHeaderMs(res.headers.get("Retry-After")));
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
  mockFeedbackSeq = 0;
}

export type CreateCopilotApiOptions = {
  fetchImpl?: typeof fetch;
  baseUrl?: string;
  forceMock?: boolean;
  fallbackMockOnMissing?: boolean;
};

export function createCopilotApi(opts: CreateCopilotApiOptions = {}): CopilotApiClient {
  const fetchImpl = withCopilotCredentials(opts.fetchImpl ?? fetch);
  const baseUrl = resolveCopilotBaseUrl(opts.baseUrl);
  const fallbackMock = opts.fallbackMockOnMissing ?? true;

  const sessionsApi = opts.forceMock
    ? createMockSessionsApi()
    : createLiveSessionsApi(fetchImpl, baseUrl);

  const mockFeedback = async (body: FeedbackRequest) => {
    const parsed = FeedbackRequestSchema.parse(body);
    mockFeedbackSeq += 1;
    return FeedbackResponseSchema.parse({ id: `fb_mock_${mockFeedbackSeq}_${parsed.drawing_id}` });
  };

  const liveStyles = async (): Promise<StylesListResponse> => {
    const res = await fetchImpl(`${baseUrl}/v1/copilot/styles`);
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new CopilotApiError(res.status, body, "styles_fetch_failed");
    }
    const json = await res.json();
    return StylesListResponseSchema.parse(json);
  };

  const liveFeedback = async (body: FeedbackRequest) => {
    const parsed = FeedbackRequestSchema.parse(body);
    const json = await jsonOrThrow<unknown>(
      await fetchImpl(`${baseUrl}/v1/copilot/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      }),
      "feedback_submit_failed",
    );
    return FeedbackResponseSchema.parse(json);
  };

  const liveProbe = async (method: "GET" | "POST"): Promise<ModelProbeReport | null> => {
    const res = await fetchImpl(`${baseUrl}/v1/copilot/models/probe`, { method });
    // 404: older backend; 409 probe_disabled: probe off (env or non-OpenAI style).
    if (res.status === 404) return null;
    if (res.status === 409) {
      const body = await readErrorBody(res);
      if (body.code === "probe_disabled") return null;
      throw new CopilotApiError(res.status, body, "models_probe_failed");
    }
    if (res.status === 429) {
      const body = await readErrorBody(res);
      throw new CopilotProbeRateLimitError(
        body,
        parseRetryAfterSeconds(res.headers.get("Retry-After"), body),
      );
    }
    if (!res.ok) {
      const body = await readErrorBody(res);
      throw new CopilotApiError(res.status, body, "models_probe_failed");
    }
    return ModelProbeReportSchema.parse(await res.json());
  };

  if (opts.forceMock) {
    return {
      fetchModels: async () => MOCK_MODELS_RESPONSE,
      fetchModelProbeReport: async () => null,
      runModelProbe: async () => null,
      fetchStyles: async () => MOCK_STYLES_RESPONSE,
      submitFeedback: mockFeedback,
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
    fetchModelProbeReport: () => liveProbe("GET"),
    runModelProbe: () => liveProbe("POST"),
    fetchStyles: liveStyles,
    submitFeedback: liveFeedback,
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
