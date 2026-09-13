"use client";

import { useEffect, useState, type FormEvent } from "react";
import { normalizeSpotSymbol } from "../lib/binance";
import { INTERVALS, type Interval } from "../lib/pattern-shape";
import { feedBadgeLabel } from "../lib/terminal-controls";
import { useChartStore } from "../lib/stores/chart-store";

const INTERVAL_LABELS: Record<Interval, string> = {
  "1m": "1m",
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1D",
};

export function TopBar() {
  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);
  const tickerPercent = useChartStore((s) => s.tickerPercent);
  const connection = useChartStore((s) => s.connection);
  const setSymbol = useChartStore((s) => s.setSymbol);
  const setInterval = useChartStore((s) => s.setInterval);
  const setConnection = useChartStore((s) => s.setConnection);
  const resetShapesSignal = useChartStore((s) => s.resetShapesSignal);

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
    if (next !== symbol) {
      setSymbol(next);
      resetShapesSignal();
    }
  };

  const onInterval = (next: Interval) => {
    if (next === interval) return;
    setInterval(next);
    resetShapesSignal();
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
              onClick={() => onInterval(tf)}
              className={`rounded px-2 py-1 hover:bg-[#2b313a] ${
                interval === tf ? "bg-[#2b313a] font-bold text-[#f0b90b]" : ""
              }`}
            >
              {INTERVAL_LABELS[tf]}
            </button>
          ))}
        </div>
      </div>

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
    </header>
  );
}
