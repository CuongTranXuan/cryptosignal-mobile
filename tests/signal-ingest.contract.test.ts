import { describe, expect, it } from "vitest";
import { signalSnapshotSchema } from "../server/signal-ingest";

const validSnapshot = {
  id: "sig_0123456789abcdef",
  assetSymbol: "BTC/USDT",
  venue: "binance_spot_public",
  timeframe: "1h",
  candleCloseTime: "2026-08-18T09:00:00Z",
  state: "NEUTRAL",
  score: 0,
  confidence: 0.25,
  regime: "RANGE",
  dataQualityState: "PASS",
  findings: [],
  conflicts: [],
  invalidation: { type: "CLOSE_ABOVE_ATR", price: 64000 },
  strategyVersion: "0.1.0",
  configVersion: 1,
  sourceManifestId: "binance:BTCUSDT:1h:2026-08-18T09:00:00Z",
};

describe("signals-only ingestion contract", () => {
  it("accepts a valid closed-candle research snapshot", () => {
    expect(signalSnapshotSchema.safeParse(validSnapshot).success).toBe(true);
  });

  it("rejects score values outside the deterministic signals-only range", () => {
    expect(signalSnapshotSchema.safeParse({ ...validSnapshot, score: 1.01 }).success).toBe(false);
  });

  it("does not admit order, stake, leverage, or exchange-secret fields in the contract", () => {
    const parsed = signalSnapshotSchema.parse({ ...validSnapshot, order: "BUY", leverage: 100, apiSecret: "must-be-discarded" });
    expect(parsed).not.toHaveProperty("order");
    expect(parsed).not.toHaveProperty("leverage");
    expect(parsed).not.toHaveProperty("apiSecret");
  });
});
