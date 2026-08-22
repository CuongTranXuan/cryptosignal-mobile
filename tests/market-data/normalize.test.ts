import { describe, expect, it } from "vitest";

import {
  bnbOpenThirtyMinuteKlineCombinedStream,
  btcAggTradeCombinedStream,
  ethBookTickerCombinedStream,
} from "./fixtures/binance-combined-streams";
import { createEventId, normalizeBinanceCombinedStream } from "../../server/market-data/normalize";

const context = {
  ingestedAt: "2026-08-22T03:00:01.000Z",
  sourceConnectionId: "collector-connection-1",
};

describe("Binance public combined-stream normalizer", () => {
  it("maps a public BTCUSDT aggregate trade to a lossless canonical event", () => {
    const event = normalizeBinanceCombinedStream(btcAggTradeCombinedStream, context);

    expect(event).toMatchObject({
      streamType: "AGG_TRADE",
      assetSymbol: "BTC/USDT",
      venue: "BINANCE_PUBLIC",
      exchangeEventTime: "2026-08-22T03:30:00.123Z",
      payload: {
        price: "112345.67000000",
        quantity: "0.01840000",
        aggregateTradeId: "123456789",
      },
    });
    expect(event?.eventId).toMatch(/^[a-f0-9]{64}$/);
    expect(event?.integrityHash).toMatch(/^[a-f0-9]{64}$/);
    expect(event && createEventId(event)).toBe(event?.eventId);
  });

  it("normalizes book ticker and closed-kline states without converting decimal source values", () => {
    const bookTicker = normalizeBinanceCombinedStream(ethBookTickerCombinedStream, context);
    const closedKline = normalizeBinanceCombinedStream(
      {
        ...bnbOpenThirtyMinuteKlineCombinedStream,
        data: {
          ...bnbOpenThirtyMinuteKlineCombinedStream.data,
          k: { ...bnbOpenThirtyMinuteKlineCombinedStream.data.k, x: true },
        },
      },
      context,
    );

    expect(bookTicker).toMatchObject({
      streamType: "BOOK_TICKER",
      assetSymbol: "ETH/USDT",
      payload: { bidPrice: "3542.12000000", askPrice: "3542.13000000" },
    });
    expect(closedKline).toMatchObject({
      streamType: "KLINE_UPDATE",
      assetSymbol: "BNB/USDT",
      isClosedCandle: true,
      payload: { interval: "30m", open: "745.12000000", close: "746.01000000" },
    });
  });

  it("rejects unknown symbols and non-approved stream payloads", () => {
    expect(
      normalizeBinanceCombinedStream({ ...btcAggTradeCombinedStream, stream: "solusdt@aggTrade" }, context),
    ).toBeNull();
    expect(normalizeBinanceCombinedStream({ stream: "btcusdt@depth", data: {} }, context)).toBeNull();
  });
});
