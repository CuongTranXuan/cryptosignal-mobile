import { useEffect, useRef, useState } from "react";
import { parseWsKline } from "./binance";
import {
  BinanceApiError,
  fetchKlines as defaultFetchKlines,
  fetchTicker as defaultFetchTicker,
  openKlineSocket,
  type ConnectWs,
  type FetchKlines,
  type FetchTicker,
  type KlinesSnapshot,
  type WsConnection,
  type WsHandlers,
} from "./market-client";
import { useChartStore } from "./stores/chart-store";

export {
  BinanceApiError,
  type ConnectWs,
  type FetchKlines,
  type FetchTicker,
  type KlinesSnapshot,
  type WsHandlers,
} from "./market-client";

export type MarketControllerDeps = {
  fetchKlines: FetchKlines;
  fetchTicker: FetchTicker;
  connectWs: ConnectWs;
  now?: () => number;
};

export type MarketController = {
  start: () => Promise<void>;
  stop: () => void;
  getClosedTimes: () => Set<number>;
  subscribeClosedTimes: (listener: (times: Set<number>) => void) => () => void;
};

function isInvalidSymbolError(error: unknown): boolean {
  return error instanceof BinanceApiError && error.code === -1121;
}

function rebuildClosedTimes(
  snapshot: KlinesSnapshot,
  nowMs: number,
  priorClosed: Set<number>,
): Set<number> {
  const next = new Set<number>();
  const { candles, closeTimesMs } = snapshot;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) continue;
    const isLast = i === candles.length - 1;
    if (isLast) {
      if (priorClosed.has(candle.time)) next.add(candle.time);
      continue;
    }
    const closeMs = closeTimesMs[i] ?? 0;
    if (closeMs < nowMs || priorClosed.has(candle.time)) {
      next.add(candle.time);
    }
  }
  return next;
}

export function createMarketController(deps: MarketControllerDeps): MarketController {
  const closedTimes = new Set<number>();
  const listeners = new Set<(times: Set<number>) => void>();
  let ws: WsConnection | null = null;
  let stopped = true;
  let generation = 0;
  let reconnecting = false;

  const notifyClosed = () => {
    const snapshot = new Set(closedTimes);
    for (const listener of listeners) listener(snapshot);
  };

  const replaceClosed = (next: Set<number>) => {
    closedTimes.clear();
    for (const t of next) closedTimes.add(t);
    notifyClosed();
  };

  const closeWs = () => {
    if (!ws) return;
    const current = ws;
    ws = null;
    current.close();
  };

  const connect = (symbol: string, interval: string, gen: number) => {
    if (stopped || gen !== generation) return;
    closeWs();
    ws = deps.connectWs(symbol, interval, {
      onMessage: (payload) => {
        if (stopped || gen !== generation) return;
        const parsed = parseWsKline(payload);
        if (!parsed) return;
        const store = useChartStore.getState();
        if (parsed.symbol !== store.symbol || parsed.interval !== store.interval) return;
        store.applyKline(parsed.candle, parsed.closed);
        if (parsed.closed) {
          closedTimes.add(parsed.candle.time);
          notifyClosed();
        }
      },
      onClose: () => {
        void handleDisconnect(gen);
      },
      onError: () => {
        void handleDisconnect(gen);
      },
    });
  };

  const loadHistory = async (symbol: string, interval: string, gen: number): Promise<boolean> => {
    if (stopped || gen !== generation) return false;
    try {
      const [snapshot, ticker] = await Promise.all([
        deps.fetchKlines(symbol, interval),
        deps.fetchTicker(symbol),
      ]);
      if (stopped || gen !== generation) return false;

      const nowMs = (deps.now ?? Date.now)();
      replaceClosed(rebuildClosedTimes(snapshot, nowMs, closedTimes));

      const store = useChartStore.getState();
      store.setCandles(snapshot.candles);
      store.setTickerPercent(ticker);
      store.setConnection("live");
      return true;
    } catch (error) {
      if (stopped || gen !== generation) return false;
      const store = useChartStore.getState();
      if (isInvalidSymbolError(error)) {
        closedTimes.clear();
        notifyClosed();
        store.setCandles([]);
        store.setTickerPercent(null);
        store.setConnection("pair-unavailable");
        return false;
      }
      store.setConnection("history-error");
      return false;
    }
  };

  const handleDisconnect = async (gen: number) => {
    if (stopped || gen !== generation || reconnecting) return;
    reconnecting = true;
    try {
      useChartStore.getState().setConnection("reconnecting");
      closeWs();
      const { symbol, interval } = useChartStore.getState();
      const ok = await loadHistory(symbol, interval, gen);
      if (!ok || stopped || gen !== generation) return;
      connect(symbol, interval, gen);
    } finally {
      reconnecting = false;
    }
  };

  const bootstrap = async (gen: number) => {
    const { symbol, interval } = useChartStore.getState();
    const ok = await loadHistory(symbol, interval, gen);
    if (!ok || stopped || gen !== generation) return;
    connect(symbol, interval, gen);
  };

  return {
    start: async () => {
      stopped = false;
      generation += 1;
      const gen = generation;
      closeWs();
      await bootstrap(gen);
    },
    stop: () => {
      stopped = true;
      generation += 1;
      reconnecting = false;
      closeWs();
    },
    getClosedTimes: () => new Set(closedTimes),
    subscribeClosedTimes: (listener) => {
      listeners.add(listener);
      listener(new Set(closedTimes));
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type UseBinanceMarketDeps = Partial<MarketControllerDeps>;

export function useBinanceMarket(deps: UseBinanceMarketDeps = {}): {
  closedTimes: Set<number>;
} {
  const symbol = useChartStore((s) => s.symbol);
  const interval = useChartStore((s) => s.interval);
  const [closedTimes, setClosedTimes] = useState<Set<number>>(() => new Set());
  const depsRef = useRef(deps);
  depsRef.current = deps;

  useEffect(() => {
    const resolved: MarketControllerDeps = {
      fetchKlines: depsRef.current.fetchKlines ?? defaultFetchKlines,
      fetchTicker: depsRef.current.fetchTicker ?? defaultFetchTicker,
      connectWs: depsRef.current.connectWs ?? openKlineSocket,
      now: depsRef.current.now,
    };
    const controller = createMarketController(resolved);
    const unsub = controller.subscribeClosedTimes(setClosedTimes);
    void controller.start();
    return () => {
      unsub();
      controller.stop();
    };
  }, [symbol, interval]);

  return { closedTimes };
}
