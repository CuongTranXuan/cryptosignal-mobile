import { describe, expect, it, vi } from "vitest";

import { createBinanceCollector } from "../../server/market-data/binance-collector";
import { bnbOpenThirtyMinuteKlineCombinedStream } from "./fixtures/binance-combined-streams";

class FakeSocket {
  readonly listeners = new Map<string, ((value?: unknown) => void)[]>();

  on(event: string, listener: (value?: unknown) => void) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
    return this;
  }

  emit(event: string, value?: unknown) {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(value);
    }
  }

  close() {
    this.emit("close");
  }
}

async function flushCollector() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function createDependencies() {
  const socket = new FakeSocket();
  const calls: string[] = [];
  return {
    socket,
    calls,
    socketFactory: vi.fn((_url: string) => socket),
    spool: { append: vi.fn(async () => calls.push("spool")) },
    cache: { writeLatest: vi.fn(async () => calls.push("cache")) },
    publishClosedKline: vi.fn(async () => calls.push("publish")),
    recordAuditEvent: vi.fn(async () => calls.push("audit")),
    recordHealth: vi.fn(async () => undefined),
  };
}

describe("public Binance combined-stream collector", () => {
  it("subscribes only to the approved public watchlist streams", async () => {
    const deps = createDependencies();
    const collector = createBinanceCollector({
      ...deps,
      config: { assetSymbols: ["BTC/USDT"], timeframes: ["30m"], endpoint: "ws://test.local/stream" },
    });

    await collector.start();

    const [socketUrl] = deps.socketFactory.mock.calls[0];
    expect(new URL(socketUrl).searchParams.get("streams")).toBe("btcusdt@aggTrade/btcusdt@bookTicker/btcusdt@kline_30m");
    await collector.stop();
  });

  it("rejects arbitrary WebSocket endpoint overrides outside Binance public WSS and test URLs", async () => {
    const deps = createDependencies();
    const collector = createBinanceCollector({
      ...deps,
      config: { assetSymbols: ["BTC/USDT"], timeframes: ["30m"], endpoint: "wss://untrusted.example/stream" },
    });

    await expect(collector.start()).rejects.toThrow("Binance public WSS");
    expect(deps.socketFactory).not.toHaveBeenCalled();
  });

  it("spools before caching and records a closed-kline notice without creating a confirmed signal", async () => {
    const deps = createDependencies();
    const collector = createBinanceCollector({
      ...deps,
      config: { assetSymbols: ["BNB/USDT"], timeframes: ["30m"], endpoint: "ws://test.local/stream" },
    });
    await collector.start();

    deps.socket.emit(
      "message",
      JSON.stringify({
        ...bnbOpenThirtyMinuteKlineCombinedStream,
        data: {
          ...bnbOpenThirtyMinuteKlineCombinedStream.data,
          k: { ...bnbOpenThirtyMinuteKlineCombinedStream.data.k, x: true },
        },
      }),
    );
    await flushCollector();

    expect(deps.calls).toEqual(["spool", "cache", "publish", "audit"]);
    expect(deps.recordAuditEvent).toHaveBeenCalledWith(
      "LIVE_KLINE_CLOSED",
      "MARKET_COLLECTOR",
      "binance-public",
      expect.objectContaining({ dataQualityState: "LIVE_UNCONFIRMED" }),
    );
    await collector.stop();
  });

  it("drops a valid but non-configured kline interval received outside its explicit subscription", async () => {
    const deps = createDependencies();
    const collector = createBinanceCollector({
      ...deps,
      config: { assetSymbols: ["BNB/USDT"], timeframes: ["30m"], endpoint: "ws://test.local/stream" },
    });
    await collector.start();
    deps.socket.emit(
      "message",
      JSON.stringify({
        ...bnbOpenThirtyMinuteKlineCombinedStream,
        stream: "bnbusdt@kline_1h",
        data: {
          ...bnbOpenThirtyMinuteKlineCombinedStream.data,
          k: { ...bnbOpenThirtyMinuteKlineCombinedStream.data.k, i: "1h" },
        },
      }),
    );
    await flushCollector();

    expect(deps.spool.append).not.toHaveBeenCalled();
    expect(deps.cache.writeLatest).not.toHaveBeenCalled();
    await collector.stop();
  });

  it("records degraded health but continues from the durable spool path when Redis fails", async () => {
    const deps = createDependencies();
    deps.cache.writeLatest.mockRejectedValueOnce(new Error("redis down"));
    const collector = createBinanceCollector({
      ...deps,
      config: { assetSymbols: ["BNB/USDT"], timeframes: ["30m"], endpoint: "ws://test.local/stream" },
    });
    await collector.start();
    deps.socket.emit("message", JSON.stringify(bnbOpenThirtyMinuteKlineCombinedStream));
    await flushCollector();

    expect(deps.spool.append).toHaveBeenCalledTimes(1);
    expect(deps.recordHealth).toHaveBeenCalledWith(expect.objectContaining({ state: "DEGRADED" }));
    await collector.stop();
  });
});
