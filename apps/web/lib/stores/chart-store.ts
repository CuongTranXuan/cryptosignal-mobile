import { create } from "zustand";
import type { Candle, Interval } from "../pattern-shape";

export type ConnectionStatus = "live" | "reconnecting" | "history-error" | "pair-unavailable";

type ChartState = {
  symbol: string;
  interval: Interval;
  candles: Candle[];
  tickerPercent: number | null;
  connection: ConnectionStatus;
  shapesResetSignal: number;
  setSymbol: (symbol: string) => void;
  setInterval: (interval: Interval) => void;
  setCandles: (candles: Candle[]) => void;
  applyKline: (candle: Candle, closed: boolean) => void;
  setTickerPercent: (tickerPercent: number | null) => void;
  setConnection: (connection: ConnectionStatus) => void;
  resetShapesSignal: () => void;
};

export const useChartStore = create<ChartState>((set, get) => ({
  symbol: "BTCUSDT",
  interval: "1h",
  candles: [],
  tickerPercent: null,
  connection: "live",
  shapesResetSignal: 0,
  setSymbol: (symbol) => set({ symbol }),
  setInterval: (interval) => set({ interval }),
  setCandles: (candles) => set({ candles }),
  setTickerPercent: (tickerPercent) => set({ tickerPercent }),
  setConnection: (connection) => set({ connection }),
  resetShapesSignal: () => set({ shapesResetSignal: get().shapesResetSignal + 1 }),
  applyKline: (candle, _closed) => {
    const candles = get().candles;
    const index = candles.findIndex((c) => c.time === candle.time);
    if (index === -1) {
      set({ candles: [...candles, candle].sort((a, b) => a.time - b.time) });
      return;
    }
    const next = candles.slice();
    next[index] = candle;
    set({ candles: next });
  },
}));
