import { describe, expect, it } from "vitest";
import { LIVE_CONDITION_IDS, LIVE_STREAM_TYPES } from "../../shared/live-market-types";
import {
  bnbOpenThirtyMinuteKlineCombinedStream,
  btcAggTradeCombinedStream,
  ethBookTickerCombinedStream,
} from "./fixtures/binance-combined-streams";

describe("live market contracts", () => {
  it("keeps only the approved initial stream types and live conditions", () => {
    expect(LIVE_STREAM_TYPES).toEqual(["AGG_TRADE", "BOOK_TICKER", "KLINE_UPDATE"]);
    expect(LIVE_CONDITION_IDS).toEqual([
      "PRICE_DISPLACEMENT_V1",
      "SPREAD_ANOMALY_V1",
      "TRADE_FLOW_IMBALANCE_V1",
      "OPEN_CANDLE_THRESHOLD_V1",
    ]);
  });

  it("freezes only credential-free public aggregate trade, book ticker, and open-kline examples", () => {
    expect(btcAggTradeCombinedStream).toMatchObject({ stream: "btcusdt@aggTrade", data: { e: "aggTrade", s: "BTCUSDT" } });
    expect(ethBookTickerCombinedStream).toMatchObject({ stream: "ethusdt@bookTicker", data: { s: "ETHUSDT" } });
    expect(bnbOpenThirtyMinuteKlineCombinedStream).toMatchObject({ stream: "bnbusdt@kline_30m", data: { e: "kline", s: "BNBUSDT", k: { i: "30m", x: false } } });
    expect(JSON.stringify([btcAggTradeCombinedStream, ethBookTickerCombinedStream, bnbOpenThirtyMinuteKlineCombinedStream])).not.toMatch(/api[-_]?key|secret|signature|order/i);
  });
});
