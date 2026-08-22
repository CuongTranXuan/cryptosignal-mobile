import { describe, expect, it, vi } from "vitest";

import { createPublicQuoteService, PublicQuoteUnavailableError } from "../../server/market-data/public-quote";

describe("public live quote fallback", () => {
  it("uses the market-data-only book ticker endpoint with no credentials and preserves numeric strings", async () => {
    const fetcher = vi.fn(async (url: string, _init?: RequestInit) => {
      expect(url).toBe("https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=BTCUSDT");
      return new Response(JSON.stringify({ symbol: "BTCUSDT", bidPrice: "64000.12000000", bidQty: "1.5", askPrice: "64001.34000000", askQty: "2.0" }), { status: 200 });
    });

    const quote = await createPublicQuoteService({ fetcher, now: () => new Date("2026-08-22T10:00:00.000Z") }).getQuote("BTC/USDT");

    expect(quote).toEqual({
      assetSymbol: "BTC/USDT",
      source: "BINANCE_PUBLIC_REST",
      observedAt: "2026-08-22T10:00:00.000Z",
      bidPrice: "64000.12000000",
      bidQuantity: "1.5",
      askPrice: "64001.34000000",
      askQuantity: "2.0",
    });
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ headers: undefined });
  });

  it("returns an explicit unavailable error without falling back to private or trading endpoints", async () => {
    const fetcher = vi.fn(async (_url: string, _init?: RequestInit) => new Response("upstream unavailable", { status: 503 }));
    const service = createPublicQuoteService({ fetcher });

    await expect(service.getQuote("ETH/USDT")).rejects.toBeInstanceOf(PublicQuoteUnavailableError);
    expect(fetcher.mock.calls[0]?.[0]).toBe("https://data-api.binance.vision/api/v3/ticker/bookTicker?symbol=ETHUSDT");
  });
});
