import type {
  CopilotModelRecord,
  ModelProbeReport,
  ModelProbeResult,
  ModelProbeStatus,
  ModelsListResponse,
} from "./copilot-schema";
import { MODEL_PROBE_STATUSES } from "./copilot-schema";
import {
  COPILOT_PROBE_CHECKED_AT,
  COPILOT_PROBE_DAYS_AGO,
  COPILOT_PROBE_HOURS_AGO,
  COPILOT_PROBE_JUST_NOW,
  COPILOT_PROBE_MINUTES_AGO,
  COPILOT_PROBE_IN_PROGRESS,
  COPILOT_PROBE_NEVER,
  COPILOT_PROBE_PROGRESS,
  COPILOT_PROBE_PROGRESS_DONE,
  COPILOT_PROBE_REASON_UNKNOWN,
} from "./copilot-strings";

const PROBE_STATUS_LABELS: Record<Exclude<ModelProbeStatus, "ok">, string> = {
  auth_error: "Sai khóa API",
  quota_or_rate_limited: "Hết hạn mức / bị giới hạn",
  not_found: "Không tìm thấy model",
  timeout: "Hết thời gian chờ",
  upstream_error: "Lỗi máy chủ upstream",
  provider_unconfigured: "Chưa cấu hình nhà cung cấp",
};

function isProbeStatus(status: string): status is ModelProbeStatus {
  return (MODEL_PROBE_STATUSES as readonly string[]).includes(status);
}

const UPSTREAM_ERROR_LABELS: Record<string, string> = {
  connect_error: "không kết nối được (máy chủ không phản hồi)",
  network_error: "lỗi mạng khi gọi OmniRoute",
  timeout: "hết thời gian chờ danh sách mô hình",
  auth_error: "OmniRoute từ chối khóa API",
  quota_or_rate_limited: "OmniRoute đang giới hạn yêu cầu",
  http_error: "OmniRoute trả lỗi HTTP",
  invalid_response: "OmniRoute trả dữ liệu không hợp lệ",
  upstream_error: "lỗi máy chủ OmniRoute",
  probe_error: "lỗi nội bộ khi kiểm tra mô hình",
};

/** Vietnamese reason for `upstream_error.code` (the backend `message` is English detail). */
export function upstreamErrorLabel(code: string | null | undefined): string | null {
  if (!code) return null;
  return UPSTREAM_ERROR_LABELS[code] ?? "lỗi không xác định";
}

/** Vietnamese reason for a failed probe status (unknown statuses get a generic reason). */
export function probeStatusLabel(status: string): string {
  if (isProbeStatus(status) && status !== "ok") return PROBE_STATUS_LABELS[status];
  return COPILOT_PROBE_REASON_UNKNOWN;
}

/** Secondary detail for a hidden model: latency · HTTP status · upstream message. */
export function probeDetailLine(result: ModelProbeResult): string {
  const parts: string[] = [];
  if (result.latency_ms != null) parts.push(`${Math.round(result.latency_ms)} ms`);
  if (result.http_status != null) parts.push(`HTTP ${result.http_status}`);
  const message = result.message?.trim() || result.error_code?.trim();
  if (message) parts.push(message);
  return parts.join(" · ");
}

export function hiddenModelsFromReport(report: ModelProbeReport | null): ModelProbeResult[] {
  return report?.results.filter((r) => r.status !== "ok") ?? [];
}

/**
 * A probe is still running, so `/models` only lists the healthy models found so far.
 * Until it completes, a selected model missing from the list is not a reason to switch.
 */
export function isProbeIncomplete(
  response: ModelsListResponse | null,
  report: ModelProbeReport | null,
): boolean {
  return (
    response?.probe_in_progress === true ||
    report?.probe_in_progress === true ||
    report?.complete === false
  );
}

/**
 * Progress while a probe runs: "(N/M)" when the wire `total` is known (N = total −
 * pending_count, else results so far), "(đã xong N)" when only N is known.
 */
export function formatProbeProgress(
  report: ModelProbeReport | null,
  total: number | null | undefined = report?.total,
  pendingCount: number | null | undefined = report?.pending_count,
): string {
  // `total` is null while the probe is still loading the upstream model list.
  const done =
    total != null && pendingCount != null
      ? Math.max(0, total - pendingCount)
      : (report?.results.length ?? 0);
  if (total != null && total > 0 && total >= done) {
    return COPILOT_PROBE_PROGRESS.replace("{done}", String(done)).replace("{total}", String(total));
  }
  if (done === 0) return COPILOT_PROBE_IN_PROGRESS;
  return COPILOT_PROBE_PROGRESS_DONE.replace("{done}", String(done));
}

export type ModelsAvailability = "unknown" | "healthy" | "empty" | "down" | "probing";

export function modelsAvailability(
  response: ModelsListResponse | null,
  report: ModelProbeReport | null = null,
): ModelsAvailability {
  if (!response) return "unknown";
  if (response.upstream_reachable === false) return "down";
  if (response.models.length === 0) {
    return isProbeIncomplete(response, report) ? "probing" : "empty";
  }
  return "healthy";
}

/** Older backends omit `probed_at` entirely; the probe UI stays hidden for them. */
export function isProbeSupported(response: ModelsListResponse | null): boolean {
  return response?.probed_at !== undefined;
}

function relativeAgo(elapsedMs: number): string {
  const minutes = Math.floor(Math.max(0, elapsedMs) / 60_000);
  if (minutes < 1) return COPILOT_PROBE_JUST_NOW;
  if (minutes < 60) return COPILOT_PROBE_MINUTES_AGO.replace("{n}", String(minutes));
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return COPILOT_PROBE_HOURS_AGO.replace("{n}", String(hours));
  return COPILOT_PROBE_DAYS_AGO.replace("{n}", String(Math.floor(hours / 24)));
}

/** "Kiểm tra lúc 11:42 · 3 phút trước" in the browser's local time zone. */
export function formatProbedAt(probedAt: string | null | undefined, now: number): string {
  const at = probedAt ? Date.parse(probedAt) : Number.NaN;
  if (!Number.isFinite(at)) return COPILOT_PROBE_NEVER;
  const d = new Date(at);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return COPILOT_PROBE_CHECKED_AT.replace("{time}", time).replace("{ago}", relativeAgo(now - at));
}

const DEFAULT_RETRY_AFTER_S = 30;
const MAX_RETRY_AFTER_S = 600;

function positiveSeconds(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.ceil(n) : null;
}

function retryAfterFromBody(body: unknown): number | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  return positiveSeconds(record.retry_after_s) ?? retryAfterFromBody(record.detail);
}

/** Seconds to wait after a 429 from `POST /models/probe` (header, then body, then 30s). */
export function parseRetryAfterSeconds(
  header: string | null | undefined,
  body: unknown,
  now: number = Date.now(),
): number {
  let seconds = positiveSeconds(header);
  if (seconds == null && header?.trim()) {
    const date = Date.parse(header);
    if (Number.isFinite(date)) seconds = positiveSeconds((date - now) / 1000);
  }
  seconds = seconds ?? retryAfterFromBody(body) ?? DEFAULT_RETRY_AFTER_S;
  return Math.min(seconds, MAX_RETRY_AFTER_S);
}

export function retryCountdownSeconds(rateLimitedUntil: number | null, now: number): number {
  if (rateLimitedUntil == null) return 0;
  return Math.max(0, Math.ceil((rateLimitedUntil - now) / 1000));
}

const MIN_REFETCH_MS = 30_000;
const IN_PROGRESS_REFETCH_MS = 10_000;

/**
 * When to re-read `/models`: soon while a probe runs, after a short pause when the
 * result is stale, otherwise when the server TTL expires. `null` for legacy backends.
 */
export function nextModelsRefetchDelayMs(
  response: ModelsListResponse | null,
  now: number,
  report: ModelProbeReport | null = null,
): number | null {
  if (!response || !isProbeSupported(response)) return null;
  if (isProbeIncomplete(response, report)) return IN_PROGRESS_REFETCH_MS;
  if (response.stale) return MIN_REFETCH_MS;
  const ttlMs = (response.ttl_s ?? 0) * 1000;
  if (ttlMs <= 0) return null;
  const probedAt = response.probed_at ? Date.parse(response.probed_at) : Number.NaN;
  const due = Number.isFinite(probedAt) ? probedAt + ttlMs - now : ttlMs;
  return Math.max(MIN_REFETCH_MS, due);
}

/**
 * Saved model that is missing from the healthy list, so the session must switch.
 * Returns null when nothing changes or there is no healthy model to switch to.
 */
export function modelSwitchedFrom(
  models: CopilotModelRecord[],
  savedId: string | null | undefined,
  resolvedId: string | null | undefined,
): string | null {
  const saved = savedId?.trim();
  if (!saved || !resolvedId || saved === resolvedId || models.length === 0) return null;
  return models.some((m) => m.id === saved) ? null : saved;
}

/**
 * Session model to use: while a probe is incomplete the saved model is kept even when the
 * partial healthy list does not contain it yet; otherwise `resolve` picks a healthy one.
 */
export function resolveModelDuringProbe(
  savedId: string | null | undefined,
  incomplete: boolean,
  resolve: () => string | null,
): string | null {
  const saved = savedId?.trim();
  if (incomplete && saved) return saved;
  return resolve();
}

export function probeReasonForModel(
  report: ModelProbeReport | null,
  modelId: string,
): string | undefined {
  const hit = report?.results.find((r) => r.id === modelId && r.status !== "ok");
  return hit ? probeStatusLabel(hit.status) : undefined;
}

export type UnhealthyModelError = { status: string | null };

const UNHEALTHY_MODEL_CODES = new Set([
  "model_unhealthy",
  "unhealthy_model",
  "model_unavailable",
  "unknown_model",
]);

/** Backend detail string: "<model id>: probe status timeout". */
const DETAIL_PROBE_STATUS = /probe status ([a-z_]+)/i;

function readUnhealthy(body: Record<string, unknown>): UnhealthyModelError | null {
  const probe = body.probe as Record<string, unknown> | undefined;
  const detailMatch = typeof body.detail === "string" ? DETAIL_PROBE_STATUS.exec(body.detail) : null;
  const probeStatus =
    (typeof body.probe_status === "string" && body.probe_status) ||
    (probe && typeof probe.status === "string" && probe.status) ||
    detailMatch?.[1] ||
    null;
  if (probeStatus) return { status: probeStatus };
  const code = typeof body.code === "string" ? body.code : typeof body.error === "string" ? body.error : "";
  if (UNHEALTHY_MODEL_CODES.has(code.trim().toLowerCase())) return { status: null };
  return null;
}

/**
 * 4xx (not 429) from analyze that names an unhealthy model. Backend today:
 * `422 {code: "model_unavailable", detail: "<id>: probe status <status>"}`.
 */
export function unhealthyModelFromError(status: number, body: unknown): UnhealthyModelError | null {
  if (status < 400 || status >= 500 || status === 429) return null;
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;
  const top = readUnhealthy(record);
  if (top) return top;
  const detail = record.detail;
  return detail && typeof detail === "object" ? readUnhealthy(detail as Record<string, unknown>) : null;
}
