"use client";

import { useEffect, useRef, useState } from "react";
import type { CopilotApiClient } from "../../lib/copilot-api";
import {
  formatProbedAt,
  hiddenModelsFromReport,
  isProbeSupported,
  modelsAvailability,
  probeDetailLine,
  probeStatusLabel,
  retryCountdownSeconds,
} from "../../lib/copilot-model-probe";
import {
  COPILOT_NO_MODELS_BODY,
  COPILOT_NO_MODELS_TITLE,
  COPILOT_NOTICE_DISMISS,
  COPILOT_PROBE_HIDDEN_TITLE,
  COPILOT_PROBE_HIDDEN_TOGGLE,
  COPILOT_PROBE_IN_PROGRESS,
  COPILOT_PROBE_RETRY,
  COPILOT_PROBE_RETRY_IN,
  COPILOT_PROBE_STALE,
  COPILOT_PROBE_STALE_HINT,
  COPILOT_UPSTREAM_DOWN_BODY,
  COPILOT_UPSTREAM_DOWN_TITLE,
  copilotDefaultFallbackNotice,
} from "../../lib/copilot-strings";
import { useAiStore } from "../../lib/stores/ai-store";
import { useCopilotSessionStore } from "../../lib/stores/copilot-session-store";
import { CopilotModelPicker } from "./copilot-model-picker";
import {
  reprobeCopilotModels,
  useCopilotModels,
  useCopilotModelsAutoRefresh,
} from "./use-copilot-models";

/** Re-renders every `intervalMs` so relative times and countdowns stay current. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function ReprobeButton({ api }: { api: CopilotApiClient }) {
  const { probing, rateLimitedUntil } = useCopilotModels(api);
  const now = useNow(rateLimitedUntil != null ? 1000 : 30_000);
  const waitS = retryCountdownSeconds(rateLimitedUntil, now);
  const label = probing
    ? COPILOT_PROBE_IN_PROGRESS
    : waitS > 0
      ? COPILOT_PROBE_RETRY_IN.replace("{seconds}", String(waitS))
      : COPILOT_PROBE_RETRY;
  return (
    <button
      type="button"
      disabled={probing || waitS > 0}
      aria-busy={probing}
      onClick={() => void reprobeCopilotModels(api)}
      className="flex flex-none items-center gap-1.5 whitespace-nowrap rounded border border-[#2b313a] px-2 py-1 text-[11px] text-[#eaecef] hover:border-[#f0b90b] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {probing && (
        <span
          className="h-3 w-3 animate-spin rounded-full border-2 border-[#848e9c] border-t-[#f0b90b]"
          aria-hidden
        />
      )}
      {label}
    </button>
  );
}

function HiddenModelsToggle({ api }: { api: CopilotApiClient }) {
  const { report } = useCopilotModels(api);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const hidden = hiddenModelsFromReport(report);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (hidden.length === 0) return null;
  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="text-[10px] text-[#848e9c] hover:text-[#f0b90b]"
      >
        {COPILOT_PROBE_HIDDEN_TOGGLE.replace("{count}", String(hidden.length))} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-1 w-96 rounded border border-[#2b313a] bg-[#1e2329] p-2 shadow-lg">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[#848e9c]">
            {COPILOT_PROBE_HIDDEN_TITLE}
          </div>
          <ul className="max-h-72 space-y-1 overflow-y-auto">
            {hidden.map((result) => {
              const detail = probeDetailLine(result);
              return (
                <li key={result.id} className="rounded bg-[#14161a] px-2 py-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <span className="truncate font-[family-name:var(--font-plex-mono)] text-[#eaecef]">
                      {result.id}
                    </span>
                    <span className="flex-none text-[#f6465d]">{probeStatusLabel(result.status)}</span>
                  </div>
                  {detail && <div className="mt-0.5 text-[10px] text-[#848e9c]">{detail}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Always-visible model picker + OmniRoute probe status for the top bar. */
export function CopilotModelBar({ api }: { api: CopilotApiClient }) {
  const { response } = useCopilotModels(api);
  const modelId = useCopilotSessionStore((s) => s.modelId);
  const setModelId = useCopilotSessionStore((s) => s.setModelId);
  const reconcile = useCopilotSessionStore((s) => s.reconcileModelWithCatalog);
  const inFlight = useAiStore((s) => s.inFlight);
  const now = useNow(30_000);

  useCopilotModelsAutoRefresh(api, response);

  useEffect(() => {
    if (response) reconcile();
  }, [response, reconcile]);

  const probeSupported = isProbeSupported(response);

  return (
    <div className="flex items-center gap-2">
      <CopilotModelPicker
        api={api}
        selectedModelId={modelId}
        onSelect={setModelId}
        disabled={inFlight}
      />
      {probeSupported && (
        <>
          <div className="flex min-w-0 flex-col items-start leading-tight">
            <span className="flex items-center gap-1 whitespace-nowrap text-[10px] text-[#848e9c]">
              {formatProbedAt(response?.probed_at, now)}
              {response?.stale && (
                <span
                  className="rounded bg-[#f0b90b]/15 px-1 text-[#f0b90b]"
                  title={COPILOT_PROBE_STALE_HINT}
                >
                  {COPILOT_PROBE_STALE}
                </span>
              )}
            </span>
            <HiddenModelsToggle api={api} />
          </div>
          <ReprobeButton api={api} />
        </>
      )}
    </div>
  );
}

function Banner({
  tone,
  title,
  detail,
  action,
  onDismiss,
}: {
  tone: "error" | "warn";
  title: string;
  detail?: string | null;
  action?: React.ReactNode;
  onDismiss?: () => void;
}) {
  const color =
    tone === "error"
      ? "border-[#f6465d]/40 bg-[#f6465d]/10 text-[#f6465d]"
      : "border-[#f0b90b]/40 bg-[#f0b90b]/10 text-[#f0b90b]";
  return (
    <div
      className={`flex items-center gap-3 rounded border px-3 py-1.5 text-xs ${color}`}
      role={tone === "error" ? "alert" : "status"}
    >
      <div className="min-w-0 flex-1">
        <span className="font-semibold">{title}</span>
        {detail && <span className="ml-2 text-[11px] text-[#eaecef]/80">{detail}</span>}
      </div>
      {action}
      {onDismiss && (
        <button
          type="button"
          aria-label={COPILOT_NOTICE_DISMISS}
          onClick={onDismiss}
          className="flex-none px-1 text-[#848e9c] hover:text-white"
        >
          ×
        </button>
      )}
    </div>
  );
}

/** Full-width notices under the top bar: OmniRoute down, no healthy model, auto-switch, fallback. */
export function CopilotModelBanner({ api }: { api: CopilotApiClient }) {
  const { response, probeError } = useCopilotModels(api);
  const modelNotice = useCopilotSessionStore((s) => s.modelNotice);
  const dismissModelNotice = useCopilotSessionStore((s) => s.dismissModelNotice);
  const [dismissedFallback, setDismissedFallback] = useState<string | null>(null);

  const availability = modelsAvailability(response);
  const fallbackKey =
    response?.default_fallback && response.requested_default && response.default_model
      ? `${response.requested_default}->${response.default_model}`
      : null;
  const showFallback = availability === "healthy" && fallbackKey && fallbackKey !== dismissedFallback;

  if (availability !== "down" && availability !== "empty" && !modelNotice && !showFallback && !probeError) {
    return null;
  }

  return (
    <div className="flex flex-none flex-col gap-1 border-b border-[#2b313a] bg-[#181a20] px-4 py-1.5">
      {availability === "down" && (
        <Banner
          tone="error"
          title={COPILOT_UPSTREAM_DOWN_TITLE}
          detail={[COPILOT_UPSTREAM_DOWN_BODY, response?.upstream_error?.message]
            .filter(Boolean)
            .join(" · ")}
          action={<ReprobeButton api={api} />}
        />
      )}
      {availability === "empty" && (
        <Banner
          tone="error"
          title={COPILOT_NO_MODELS_TITLE}
          detail={COPILOT_NO_MODELS_BODY}
          action={<ReprobeButton api={api} />}
        />
      )}
      {modelNotice && <Banner tone="warn" title={modelNotice} onDismiss={dismissModelNotice} />}
      {showFallback && (
        <Banner
          tone="warn"
          title={copilotDefaultFallbackNotice(response!.requested_default!, response!.default_model!)}
          onDismiss={() => setDismissedFallback(fallbackKey)}
        />
      )}
      {probeError && <Banner tone="error" title={probeError} />}
    </div>
  );
}
