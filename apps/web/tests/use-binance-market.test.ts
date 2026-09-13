import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Candle } from "../lib/pattern-shape";
import { useChartStore } from "../lib/stores/chart-store";
import {
  BinanceApiError,
  createMarketController,
  useBinanceMarket,
  type ConnectWs,
  type FetchKlines,
  type FetchTicker,
  type WsHandlers,
} from "../lib/use-binance-market";

const c1: Candle = {
  time: 1710000000,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
};

const c2: Candle = {
  time: 1710003600,
  open: 1.5,
  high: 2.5,
  low: 1.4,
  close: 2.0,
  volume: 8,
};

function resetStore() {
  useChartStore.setState({
    symbol: "BTCUSDT",
    interval: "1h",
    candles: [],
    tickerPercent: null,
    connection: "live",
    shapesResetSignal: 0,
  });
}

function createFakeWs() {
  let handlers: WsHandlers | null = null;
  let connectCount = 0;

  const connectWs: ConnectWs = (_symbol, _interval, h) => {
    handlers = h;
    connectCount += 1;
    return {
      close: () => {
        handlers = null;
      },
    };
  };

  return {
    connectWs,
    connectCount: () => connectCount,
    send(payload: unknown) {
      handlers?.onMessage(payload);
    },
    failWs() {
      handlers?.onError();
      handlers?.onClose();
    },
  };
}

describe("createMarketController / useBinanceMarket", () => {
  beforeEach(() => {
    resetStore();
  });

  it("loads candles, applies forming then closed ws updates, reconnects after ws drop", async () => {
    const ws = createFakeWs();
    let klineCalls = 0;
    const fetchKlines: FetchKlines = vi.fn(async () => {
      klineCalls += 1;
      return {
        candles: [c1, c2],
        closeTimesMs: [1710003599999, 1710007199999],
      };
    });
    const fetchTicker: FetchTicker = vi.fn(async () => 1.25);
    const now = () => 1710004000000; // between c1 close and c2 close

    const { result, unmount } = renderHook(() =>
      useBinanceMarket({
        fetchKlines,
        fetchTicker,
        connectWs: ws.connectWs,
        now,
      }),
    );

    await waitFor(() => {
      expect(useChartStore.getState().candles).toHaveLength(2);
    });
    expect(useChartStore.getState().tickerPercent).toBe(1.25);
    expect(useChartStore.getState().connection).toBe("live");
    expect(result.current.closedTimes.has(c1.time)).toBe(true);
    expect(result.current.closedTimes.has(c2.time)).toBe(false);

    act(() => {
      ws.send({
        s: "BTCUSDT",
        k: {
          t: c2.time * 1000,
          o: "1.5",
          h: "2.6",
          l: "1.4",
          c: "2.1",
          v: "9",
          x: false,
          i: "1h",
        },
      });
    });
    expect(useChartStore.getState().candles[1]?.close).toBe(2.1);
    expect(result.current.closedTimes.has(c2.time)).toBe(false);

    act(() => {
      ws.send({
        s: "BTCUSDT",
        k: {
          t: c2.time * 1000,
          o: "1.5",
          h: "2.6",
          l: "1.4",
          c: "2.2",
          v: "9",
          x: true,
          i: "1h",
        },
      });
    });
    expect(useChartStore.getState().candles[1]?.close).toBe(2.2);
    expect(result.current.closedTimes.has(c2.time)).toBe(true);

    const connections: string[] = [];
    const unsub = useChartStore.subscribe((s) => {
      connections.push(s.connection);
    });

    const callsBeforeFail = klineCalls;
    await act(async () => {
      ws.failWs();
    });

    await waitFor(() => {
      expect(useChartStore.getState().connection).toBe("live");
    });
    unsub();

    expect(connections).toContain("reconnecting");
    expect(klineCalls).toBeGreaterThan(callsBeforeFail);
    expect(ws.connectCount()).toBeGreaterThan(1);
    expect(fetchKlines).toHaveBeenCalled();

    unmount();
  });

  it("sets pair-unavailable and clears candles on Binance -1121", async () => {
    useChartStore.setState({ candles: [c1] });
    const ws = createFakeWs();
    const fetchKlines: FetchKlines = async () => {
      throw new BinanceApiError(-1121, "Invalid symbol.");
    };
    const fetchTicker: FetchTicker = async () => 0;

    renderHook(() =>
      useBinanceMarket({
        fetchKlines,
        fetchTicker,
        connectWs: ws.connectWs,
        now: () => 1710004000000,
      }),
    );

    await waitFor(() => {
      expect(useChartStore.getState().connection).toBe("pair-unavailable");
    });
    expect(useChartStore.getState().candles).toEqual([]);
  });

  it("sets history-error without clearing last good candles on other REST failures", async () => {
    useChartStore.setState({ candles: [c1, c2], connection: "live" });
    const ws = createFakeWs();
    const fetchKlines: FetchKlines = async () => {
      throw new Error("network down");
    };
    const fetchTicker: FetchTicker = async () => 0;

    const controller = createMarketController({
      fetchKlines,
      fetchTicker,
      connectWs: ws.connectWs,
      now: () => 1710004000000,
    });

    await controller.start();

    expect(useChartStore.getState().connection).toBe("history-error");
    expect(useChartStore.getState().candles).toEqual([c1, c2]);
    controller.stop();
  });

  it("marks last REST bar forming unless a closed ws event arrived for that time", async () => {
    const ws = createFakeWs();
    const fetchKlines: FetchKlines = async () => ({
      candles: [c1, c2],
      // both closeTimes in the past relative to now — last still forming
      closeTimesMs: [1710003599999, 1710007199999],
    });
    const fetchTicker: FetchTicker = async () => 0.5;

    const controller = createMarketController({
      fetchKlines,
      fetchTicker,
      connectWs: ws.connectWs,
      now: () => 1710008000000,
    });

    await controller.start();

    expect(controller.getClosedTimes().has(c1.time)).toBe(true);
    expect(controller.getClosedTimes().has(c2.time)).toBe(false);

    act(() => {
      ws.send({
        s: "BTCUSDT",
        k: {
          t: c2.time * 1000,
          o: "1.5",
          h: "2.5",
          l: "1.4",
          c: "2.0",
          v: "8",
          x: true,
          i: "1h",
        },
      });
    });
    expect(controller.getClosedTimes().has(c2.time)).toBe(true);

    controller.stop();
  });
});
