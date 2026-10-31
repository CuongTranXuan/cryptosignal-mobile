"use client";

import { chartKey } from "../lib/chart-state";
import { cleanSummaryText } from "../lib/summary-text";
import { intervalOrder, switchChart, useChartHistoryStore } from "../lib/chart-history";
import {
  CHART_HISTORY_LABEL,
  CHART_HISTORY_LOADING,
  CHART_HISTORY_SUMMARY_PREFIX,
  CHART_HISTORY_UNSAVED,
  CHART_HISTORY_UNSAVED_FAILED_TITLE,
  CHART_HISTORY_UNSAVED_RETRYING_TITLE,
  COPILOT_NOTICE_DISMISS,
  chartHistoryChipLabel,
} from "../lib/copilot-strings";
import { useChartStore } from "../lib/stores/chart-store";
import { INTERVAL_LABELS } from "../lib/terminal-controls";

/** Timeframes analyzed/drawn in this session; click to flip between them. */
export function ChartHistoryBar() {
  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);
  const supported = useChartHistoryStore((s) => s.supported);
  const sessionId = useChartHistoryStore((s) => s.sessionId);
  const index = useChartHistoryStore((s) => s.index);
  const docs = useChartHistoryStore((s) => s.docs);
  const loadingKey = useChartHistoryStore((s) => s.loadingKey);
  const notice = useChartHistoryStore((s) => s.notice);
  const unsavedAll = useChartHistoryStore((s) => s.unsaved);
  const dismissNotice = useChartHistoryStore((s) => s.dismissNotice);

  if (!supported || !sessionId) return null;

  const key = chartKey(sessionId, symbol, interval);
  const loading = loadingKey === key;
  const summary = loading ? null : cleanSummaryText(docs[key]?.summary_text);
  const unsaved = unsavedAll[key] ?? null;
  const entries = index
    .filter((e) => e.analyzed_at != null || e.shape_count > 0)
    .sort((a, b) => {
      const aCur = a.symbol === symbol ? 0 : 1;
      const bCur = b.symbol === symbol ? 0 : 1;
      if (aCur !== bCur) return aCur - bCur;
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return intervalOrder(a.interval) - intervalOrder(b.interval);
    });

  return (
    <div
      data-testid="chart-history-bar"
      className="flex h-7 flex-none items-center gap-2 overflow-x-auto border-b border-[#2b313a] bg-[#181a20] px-3 text-[11px] text-[#848e9c]"
    >
      <span className="flex-none">{CHART_HISTORY_LABEL}:</span>
      {entries.length === 0 && !loading && <span className="flex-none text-[#5e6673]">—</span>}
      {entries.map((e) => {
        const active = e.symbol === symbol && e.interval === interval;
        const tf = INTERVAL_LABELS[e.interval] ?? e.interval;
        const label = chartHistoryChipLabel(
          e.symbol === symbol ? tf : `${e.symbol} ${tf}`,
          e.shape_count,
          e.analyzed_at,
          e.updated_at,
        );
        return (
          <button
            key={`${e.symbol}|${e.interval}`}
            type="button"
            data-testid={`chart-history-chip-${e.symbol}-${e.interval}`}
            aria-pressed={active}
            onClick={() => switchChart(e.symbol, e.interval)}
            className={`flex-none rounded border px-2 py-0.5 font-[family-name:var(--font-plex-mono)] hover:bg-[#2b313a] ${
              active
                ? "border-[#f0b90b] bg-[#2b313a] font-bold text-[#f0b90b]"
                : "border-[#2b313a] text-[#eaecef]"
            }`}
          >
            {label}
          </button>
        );
      })}
      {loading && (
        <span data-testid="chart-history-loading" className="flex-none animate-pulse text-[#848e9c]">
          {CHART_HISTORY_LOADING}
        </span>
      )}
      {unsaved && (
        <span
          data-testid="chart-history-unsaved"
          data-state={unsaved}
          title={unsaved === "retrying" ? CHART_HISTORY_UNSAVED_RETRYING_TITLE : CHART_HISTORY_UNSAVED_FAILED_TITLE}
          className="flex flex-none items-center gap-1 rounded border border-[#f0b90b]/50 px-1.5 py-0.5 text-[#f0b90b]"
        >
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full bg-[#f0b90b] ${unsaved === "retrying" ? "animate-pulse" : ""}`}
          />
          {CHART_HISTORY_UNSAVED}
        </span>
      )}
      {summary && (
        <span className="min-w-0 truncate text-[#848e9c]" title={summary}>
          {CHART_HISTORY_SUMMARY_PREFIX}: {summary}
        </span>
      )}
      {notice && (
        <span
          data-testid="chart-history-notice"
          className="ml-auto flex flex-none items-center gap-1 rounded bg-[#3a2a12] px-2 py-0.5 text-[#f0b90b]"
        >
          {notice}
          <button
            type="button"
            aria-label={COPILOT_NOTICE_DISMISS}
            className="text-[#848e9c] hover:text-white"
            onClick={dismissNotice}
          >
            ×
          </button>
        </span>
      )}
    </div>
  );
}
