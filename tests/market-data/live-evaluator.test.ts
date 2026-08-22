import { describe, expect, it, vi } from "vitest";

import { evaluateLiveSnapshot } from "../../server/market-data/live-evaluator";
import type { BotConfigView } from "../../shared/signal-types";
import type { LiveMarketSnapshot } from "../../shared/live-market-types";

const now = new Date("2026-08-22T04:00:00.000Z");
const eventTime = "2026-08-22T03:59:50.000Z";
const baseEvent = {
  schemaVersion: 1 as const,
  venue: "BINANCE_PUBLIC" as const,
  assetSymbol: "BTC/USDT" as const,
  ingestedAt: eventTime,
  sourceConnectionId: "collector",
  isClosedCandle: false,
  integrityHash: "integrity",
};

const imbalancedSnapshot: LiveMarketSnapshot = {
  assetSymbol: "BTC/USDT",
  stale: false,
  freshestEventTime: eventTime,
  latestTrade: {
    ...baseEvent,
    eventId: "trade-1",
    streamType: "AGG_TRADE",
    exchangeEventTime: eventTime,
    payload: { price: "110", quantity: "2", buyerIsMarketMaker: false },
  },
  latestBookTicker: {
    ...baseEvent,
    eventId: "book-1",
    streamType: "BOOK_TICKER",
    exchangeEventTime: eventTime,
    payload: { bidPrice: "100", askPrice: "110" },
  },
  latestKlines: {
    "30m": {
      ...baseEvent,
      eventId: "kline-1",
      streamType: "KLINE_UPDATE",
      exchangeEventTime: eventTime,
      payload: { interval: "30m", open: "100", close: "110", isClosed: false },
    },
  },
};

const enabledLiveConfig: BotConfigView = {
  configVersion: 4,
  lastChangedBy: "DASHBOARD",
  isPaused: false,
  watchlist: ["BTC/USDT"],
  timeframes: ["30m"],
  ruleFamilies: ["TREND"],
  enabledPatterns: [],
  enabledMethodologies: [],
  liveAlerts: {
    enabled: true,
    conditionIds: ["TRADE_FLOW_IMBALANCE_V1", "PRICE_DISPLACEMENT_V1", "SPREAD_ANOMALY_V1", "OPEN_CANDLE_THRESHOLD_V1"],
    threshold: 0.05,
    cooldownMinutes: 10,
  },
  alertThreshold: 0.55,
  cooldownMinutes: 60,
  quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
};

describe("live condition evaluator", () => {
  it("labels imbalanced observations LIVE_UNCONFIRMED and never invokes confirmed signal persistence", () => {
    const recordSignalSnapshot = vi.fn();

    const observations = evaluateLiveSnapshot(imbalancedSnapshot, enabledLiveConfig, now);

    expect(observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dataQualityState: "LIVE_UNCONFIRMED",
          conditionId: "TRADE_FLOW_IMBALANCE_V1",
          direction: "BULLISH",
          sourceEventIds: ["trade-1"],
          configVersion: 4,
        }),
      ]),
    );
    expect(recordSignalSnapshot).not.toHaveBeenCalled();
  });

  it("returns no observations for stale or disabled live cache snapshots", () => {
    expect(evaluateLiveSnapshot({ ...imbalancedSnapshot, stale: true }, enabledLiveConfig, now)).toEqual([]);
    expect(evaluateLiveSnapshot(imbalancedSnapshot, { ...enabledLiveConfig, liveAlerts: { ...enabledLiveConfig.liveAlerts, enabled: false } }, now)).toEqual([]);
  });

  it("derives deterministic observation IDs from the condition, source event, minute bucket, and config version", () => {
    expect(evaluateLiveSnapshot(imbalancedSnapshot, enabledLiveConfig, now)).toEqual(evaluateLiveSnapshot(imbalancedSnapshot, enabledLiveConfig, now));
  });

  it("emits a scored, direction-neutral spread anomaly when the public book spread exceeds the live threshold", () => {
    const spread = evaluateLiveSnapshot(
      imbalancedSnapshot,
      { ...enabledLiveConfig, liveAlerts: { ...enabledLiveConfig.liveAlerts, conditionIds: ["SPREAD_ANOMALY_V1"], threshold: 0.05 } },
      now,
    ).find((observation) => observation.conditionId === "SPREAD_ANOMALY_V1");

    expect(spread).toMatchObject({ dataQualityState: "LIVE_UNCONFIRMED", direction: "NEUTRAL", score: 0.09523809523809523, evidence: { spreadRatio: 0.09523809523809523 } });
  });
});
