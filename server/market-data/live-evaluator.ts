import { createHash } from "node:crypto";

import type { LiveMarketSnapshot, LiveObservation } from "../../shared/live-market-types";
import type { BotConfigView } from "../../shared/signal-types";

type NumericPayload = Record<string, string | number | boolean | null>;

function numericValue(payload: NumericPayload | undefined, field: string) {
  const value = payload?.[field];
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function directionFromSignedValue(value: number): LiveObservation["direction"] {
  return value > 0 ? "BULLISH" : value < 0 ? "BEARISH" : "NEUTRAL";
}

function createObservation(
  snapshot: LiveMarketSnapshot,
  config: BotConfigView,
  conditionId: LiveObservation["conditionId"],
  signedEvidence: number,
  evidence: LiveObservation["evidence"],
  sourceEventIds: string[],
  observedAt: Date,
  directionOverride?: LiveObservation["direction"],
): LiveObservation {
  const minuteBucket = Math.floor(observedAt.getTime() / 60_000);
  const sourceIds = [...sourceEventIds].sort();
  const idSeed = [conditionId, snapshot.assetSymbol, sourceIds.join(","), minuteBucket, config.configVersion].join(":");
  return {
    id: `live-observation-${createHash("sha256").update(idSeed).digest("hex")}`,
    assetSymbol: snapshot.assetSymbol,
    observedAt: observedAt.toISOString(),
    conditionId,
    direction: directionOverride ?? directionFromSignedValue(signedEvidence),
    score: Math.min(1, Math.abs(signedEvidence)),
    dataQualityState: "LIVE_UNCONFIRMED",
    evidence,
    sourceEventIds: sourceIds,
    configVersion: config.configVersion,
  };
}

export function evaluateLiveSnapshot(snapshot: LiveMarketSnapshot, config: BotConfigView, now: Date): LiveObservation[] {
  const liveAlerts = config.liveAlerts;
  if (snapshot.stale || !liveAlerts.enabled || liveAlerts.conditionIds.length === 0) return [];

  const observations: LiveObservation[] = [];
  const trade = snapshot.latestTrade;
  const book = snapshot.latestBookTicker;
  const openKline = snapshot.latestKlines["30m"] ?? snapshot.latestKlines["1h"] ?? snapshot.latestKlines["4h"];
  const threshold = liveAlerts.threshold;

  const add = (
    conditionId: LiveObservation["conditionId"],
    signedEvidence: number | null,
    evidence: LiveObservation["evidence"],
    sourceEventIds: string[],
  ) => {
    if (!liveAlerts.conditionIds.includes(conditionId) || signedEvidence === null || Math.abs(signedEvidence) < threshold) return;
    observations.push(createObservation(snapshot, config, conditionId, signedEvidence, evidence, sourceEventIds, now));
  };

  const tradePrice = numericValue(trade?.payload, "price");
  const baselinePrice = numericValue(openKline?.payload, "open");
  if (tradePrice !== null && baselinePrice !== null && baselinePrice > 0 && trade && openKline) {
    const displacement = (tradePrice - baselinePrice) / baselinePrice;
    add("PRICE_DISPLACEMENT_V1", displacement, { latestPrice: tradePrice, baselinePrice, displacement }, [trade.eventId, openKline.eventId]);
  }

  const bid = numericValue(book?.payload, "bidPrice");
  const ask = numericValue(book?.payload, "askPrice");
  if (bid !== null && ask !== null && bid + ask > 0 && book) {
    const spreadRatio = (ask - bid) / ((ask + bid) / 2);
    if (liveAlerts.conditionIds.includes("SPREAD_ANOMALY_V1") && spreadRatio >= threshold) {
      observations.push(createObservation(snapshot, config, "SPREAD_ANOMALY_V1", spreadRatio, { bid, ask, spreadRatio }, [book.eventId], now, "NEUTRAL"));
    }
  }

  const quantity = numericValue(trade?.payload, "quantity");
  if (tradePrice !== null && quantity !== null && quantity > 0 && trade) {
    const notional = tradePrice * quantity;
    const buyerIsMarketMaker = trade.payload.buyerIsMarketMaker === true;
    const buyNotional = buyerIsMarketMaker ? 0 : notional;
    const sellNotional = buyerIsMarketMaker ? notional : 0;
    const imbalance = (buyNotional - sellNotional) / (buyNotional + sellNotional);
    add("TRADE_FLOW_IMBALANCE_V1", imbalance, { buyNotional, sellNotional, imbalance }, [trade.eventId]);
  }

  const open = numericValue(openKline?.payload, "open");
  const close = numericValue(openKline?.payload, "close");
  if (open !== null && close !== null && open > 0 && openKline) {
    const openCandleChange = (close - open) / open;
    add("OPEN_CANDLE_THRESHOLD_V1", openCandleChange, { open, close, openCandleChange }, [openKline.eventId]);
  }

  return observations;
}

export function createLiveEvaluatorService(deps: {
  readSnapshot(assetSymbol: LiveMarketSnapshot["assetSymbol"]): Promise<LiveMarketSnapshot>;
  getConfig(): Promise<BotConfigView>;
  recordObservation(observation: LiveObservation): Promise<{ isNew: boolean }>;
  deliverAlert(observation: LiveObservation): Promise<unknown>;
}) {
  return {
    async evaluateAsset(assetSymbol: LiveMarketSnapshot["assetSymbol"], now = new Date()) {
      const [snapshot, config] = await Promise.all([deps.readSnapshot(assetSymbol), deps.getConfig()]);
      const observations = evaluateLiveSnapshot(snapshot, config, now);
      for (const observation of observations) {
        const recorded = await deps.recordObservation(observation);
        if (recorded.isNew) await deps.deliverAlert(observation);
      }
      return { snapshot, observations };
    },
  };
}
