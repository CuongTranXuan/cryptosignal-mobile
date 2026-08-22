import { describe, expect, it, vi } from "vitest";

import { MarketCacheUnavailableError, createMarketCache } from "../../server/market-data/redis-cache";
import type { LiveMarketEvent } from "../../shared/live-market-types";

function eventFixture(overrides: Partial<LiveMarketEvent> = {}): LiveMarketEvent {
  return {
    eventId: "event-1",
    schemaVersion: 1,
    venue: "BINANCE_PUBLIC",
    streamType: "AGG_TRADE",
    assetSymbol: "BTC/USDT",
    exchangeEventTime: "2026-08-22T03:00:00.000Z",
    ingestedAt: "2026-08-22T03:00:00.100Z",
    sourceConnectionId: "collector-1",
    isClosedCandle: false,
    integrityHash: "hash-1",
    payload: { price: "112345.67" },
    ...overrides,
  };
}

function createRedisDouble() {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => values.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
      return "OK";
    }),
  };
}

describe("market Redis cache", () => {
  it("writes approved latest-event keys with the required ten-minute expiry and reads a fresh snapshot", async () => {
    const redis = createRedisDouble();
    const cache = createMarketCache(redis, { now: () => new Date("2026-08-22T03:00:30.000Z") });
    const trade = eventFixture();

    await cache.writeLatest(trade);
    const snapshot = await cache.readSnapshot("BTC/USDT");

    expect(redis.set).toHaveBeenCalledWith("market:latest:BTC/USDT:trade", JSON.stringify(trade), "EX", 600);
    expect(snapshot).toMatchObject({ assetSymbol: "BTC/USDT", latestTrade: trade, freshestEventTime: trade.exchangeEventTime, stale: false });
  });

  it("marks snapshots stale after the configured source-event threshold", async () => {
    const redis = createRedisDouble();
    const cache = createMarketCache(redis, {
      now: () => new Date("2026-08-22T03:11:00.000Z"),
      staleAfterMs: 10 * 60 * 1_000,
    });
    await cache.writeLatest(eventFixture());

    await expect(cache.readSnapshot("BTC/USDT")).resolves.toMatchObject({ stale: true });
  });

  it("surfaces Redis failures as a typed availability error", async () => {
    const cache = createMarketCache({
      get: vi.fn(async () => {
        throw new Error("redis unavailable");
      }),
      set: vi.fn(),
    });

    await expect(cache.readSnapshot("BTC/USDT")).rejects.toBeInstanceOf(MarketCacheUnavailableError);
  });
});
