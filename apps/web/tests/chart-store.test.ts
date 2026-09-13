import { beforeEach, describe, expect, it } from "vitest";
import { useChartStore } from "../lib/stores/chart-store";
import type { Candle } from "../lib/pattern-shape";

const base: Candle = {
  time: 1710000000,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
};

describe("useChartStore", () => {
  beforeEach(() => {
    useChartStore.setState({
      symbol: "BTCUSDT",
      interval: "1h",
      candles: [],
      tickerPercent: null,
      connection: "live",
      shapesResetSignal: 0,
    });
  });

  it("applyKline twice on same time updates close; closed bar remains", () => {
    const { applyKline } = useChartStore.getState();

    applyKline(base, false);
    expect(useChartStore.getState().candles).toHaveLength(1);
    expect(useChartStore.getState().candles[0]?.close).toBe(1.5);

    applyKline({ ...base, close: 1.8, high: 2.1 }, false);
    expect(useChartStore.getState().candles).toHaveLength(1);
    expect(useChartStore.getState().candles[0]?.close).toBe(1.8);

    applyKline({ ...base, close: 1.9, high: 2.1 }, true);
    expect(useChartStore.getState().candles[0]?.close).toBe(1.9);

    applyKline(
      { time: 1710003600, open: 1.9, high: 2.2, low: 1.8, close: 2.0, volume: 4 },
      false,
    );
    const candles = useChartStore.getState().candles;
    expect(candles).toHaveLength(2);
    expect(candles[0]?.time).toBe(1710000000);
    expect(candles[0]?.close).toBe(1.9);
    expect(candles[1]?.close).toBe(2.0);
  });

  it("setters update symbol interval connection ticker and candles", () => {
    const store = useChartStore.getState();
    store.setSymbol("ETHUSDT");
    store.setInterval("15m");
    store.setConnection("reconnecting");
    store.setTickerPercent(1.25);
    store.setCandles([base]);
    store.resetShapesSignal();

    const next = useChartStore.getState();
    expect(next.symbol).toBe("ETHUSDT");
    expect(next.interval).toBe("15m");
    expect(next.connection).toBe("reconnecting");
    expect(next.tickerPercent).toBe(1.25);
    expect(next.candles).toEqual([base]);
    expect(next.shapesResetSignal).toBe(1);
  });
});
