import { describe, expect, it } from "vitest";
import { LIVE_CONDITION_IDS, LIVE_STREAM_TYPES } from "../../shared/live-market-types";

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
});
