"use client";

import { useEffect, useState, type FormEvent } from "react";
import { normalizeSpotSymbol } from "../lib/binance";
import type { CopilotApiClient } from "../lib/copilot-api";
import { INTERVALS, type Interval } from "../lib/pattern-shape";
import { INTERVAL_LABELS, feedBadgeLabel } from "../lib/terminal-controls";
import { switchChart, useChartHistoryStore } from "../lib/chart-history";
import { CHART_HISTORY_DOT_TITLE } from "../lib/copilot-strings";
import { useChartStore } from "../lib/stores/chart-store";
import { CopilotModelBar } from "./copilot/copilot-model-bar";

export function TopBar({ api }: { api: CopilotApiClient }) {
  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);
  const tickerPercent = useChartStore((s) => s.tickerPercent);
  const connection = useChartStore((s) => s.connection);
  const setConnection = useChartStore((s) => s.setConnection);
  const historyIndex = useChartHistoryStore((s) => s.index);
  const savedIntervals = new Set(
    historyIndex.filter((e) => e.symbol === symbol && e.shape_count > 0).map((e) => e.interval),
  );

  const [draft, setDraft] = useState(symbol);
  useEffect(() => {
    setDraft(symbol);
  }, [symbol]);

  const onSubmitSymbol = (e: FormEvent) => {
    e.preventDefault();
    const next = normalizeSpotSymbol(draft);
    if (!next) {
      setConnection("pair-unavailable");
      return;
    }
    if (next !== symbol) switchChart(next, interval);
  };

  const onInterval = (next: Interval) => {
    if (next === interval) return;
    switchChart(symbol, next);
  };

  const pct = tickerPercent;
  const pctPositive = pct != null && pct >= 0;
  const feedLabel = feedBadgeLabel(connection);

  return (
    <header className="flex h-12 w-full flex-none items-center justify-between border-b border-[#2b313a] bg-[#181a20] px-4">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <span className="text-lg font-bold tracking-wide text-white">
            AI-CHART<span className="text-[#f0b90b]">.PRO</span>
          </span>
        </div>

        <div className="h-4 w-px bg-[#2b313a]" />

        <form onSubmit={onSubmitSymbol} className="flex items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase())}
            onBlur={() => setDraft(symbol)}
            aria-label="Symbol"
            className="w-28 rounded border border-[#2b313a] bg-[#1e2329] px-2 py-1 text-sm font-bold text-white outline-none focus:border-[#f0b90b]"
          />
          {pct != null && (
            <span
              className={`rounded bg-[#2b313a] px-1.5 py-0.5 font-[family-name:var(--font-plex-mono)] text-xs ${
                pctPositive ? "text-[#0ecb81]" : "text-[#f6465d]"
              }`}
            >
              {pctPositive ? "+" : ""}
              {pct.toFixed(2)}%
            </span>
          )}
        </form>

        <div className="flex gap-0.5 text-xs text-[#848e9c]">
          {INTERVALS.map((tf) => (
            <button
              key={tf}
              type="button"
              data-testid={`tf-${tf}`}
              onClick={() => onInterval(tf)}
              className={`relative rounded px-2 py-1 hover:bg-[#2b313a] ${
                interval === tf ? "bg-[#2b313a] font-bold text-[#f0b90b]" : ""
              }`}
            >
              {INTERVAL_LABELS[tf]}
              {savedIntervals.has(tf) && (
                <span
                  data-testid={`tf-dot-${tf}`}
                  title={CHART_HISTORY_DOT_TITLE}
                  className="absolute right-0.5 top-0.5 h-1 w-1 rounded-full bg-[#f0b90b]"
                />
              )}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <CopilotModelBar api={api} />
        <div className="h-4 w-px bg-[#2b313a]" />
        <div className="flex items-center gap-3 font-[family-name:var(--font-plex-mono)] text-[11px]">
          <div className="flex items-center gap-1.5 rounded border border-[#2b313a] bg-[#1e2329] px-2.5 py-1">
            <span
              className={`h-2 w-2 rounded-full ${
                connection === "live"
                  ? "bg-[#0ecb81]"
                  : connection === "reconnecting"
                    ? "bg-[#f0b90b]"
                    : "bg-[#f6465d]"
              }`}
            />
            <span className="text-[#848e9c]">
              Feed: <strong className="text-white">{feedLabel}</strong>
            </span>
          </div>
        </div>
      </div>
    </header>
  );
}
