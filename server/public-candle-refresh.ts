import { randomUUID } from "node:crypto";

import type { BotConfigView, CandlePatternRuleId, CandlePointInput, MethodologyRuleId, SignalFinding, SignalSnapshotInput, SignalState } from "../shared/signal-types";
import { getBotConfig, recordAuditEvent, recordCandleHistory, recordRunnerHealth, recordSignalSnapshot } from "./db";

type Candle = { openTime: number; closeTime: number; open: number; high: number; low: number; close: number; volume: number };
type IndicatorSet = { ema20: number; ema50: number; ema200: number; rsi14: number; macd: number; macdSignal: number; atr14: number };

const PUBLIC_BINANCE_BASE_URL = "https://api.binance.com/api/v3/klines";
const STRATEGY_VERSION = "PUBLIC_OHLCV_V1";

function clamp(value: number, lower: number, upper: number) {
  return Math.min(upper, Math.max(lower, value));
}

function iso(timestamp: number) {
  return new Date(timestamp).toISOString();
}

function toBinanceSymbol(assetSymbol: string) {
  return assetSymbol.replace("/", "");
}

function ema(values: number[], length: number) {
  const multiplier = 2 / (length + 1);
  const output: number[] = [];
  let current = values[0] ?? 0;
  for (const value of values) {
    current = value * multiplier + current * (1 - multiplier);
    output.push(current);
  }
  return output;
}

function rsi(values: number[], length = 14) {
  const output = Array<number>(values.length).fill(50);
  if (values.length < 2) return output;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index] - values[index - 1];
    const gain = Math.max(delta, 0);
    const loss = Math.max(-delta, 0);
    if (index <= length) {
      averageGain += gain / length;
      averageLoss += loss / length;
    } else {
      averageGain = (averageGain * (length - 1) + gain) / length;
      averageLoss = (averageLoss * (length - 1) + loss) / length;
    }
    output[index] = averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }
  return output;
}

function atr(candles: Candle[], length = 14) {
  const values = candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close ?? candle.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  return ema(values, length);
}

function calculateIndicators(candles: Candle[]): IndicatorSet[] {
  const closes = candles.map((candle) => candle.close);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsi14 = rsi(closes);
  const macdLine = ema(closes, 12).map((value, index) => value - ema(closes, 26)[index]);
  const macdSignal = ema(macdLine, 9);
  const atr14 = atr(candles);
  return candles.map((_, index) => ({ ema20: ema20[index], ema50: ema50[index], ema200: ema200[index], rsi14: rsi14[index], macd: macdLine[index], macdSignal: macdSignal[index], atr14: atr14[index] }));
}

type Candidate = {
  ruleId: string;
  ruleFamily: SignalFinding["ruleFamily"];
  direction: SignalFinding["direction"];
  weight: number;
  evidence: Record<string, unknown>;
};

function candleMetrics(candle: Candle) {
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const body = Math.abs(candle.close - candle.open);
  return {
    body,
    bodyRatio: body / range,
    upperShadow: candle.high - Math.max(candle.open, candle.close),
    lowerShadow: Math.min(candle.open, candle.close) - candle.low,
    bullish: candle.close > candle.open,
    bearish: candle.close < candle.open,
  };
}

function buildPatternCandidates(candles: Candle[], index: number, indicators: IndicatorSet): Candidate[] {
  const current = candles[index];
  const previous = candles[index - 1];
  const first = candles[index - 2];
  const metrics = candleMetrics(current);
  const candidates: Candidate[] = [];
  const add = (ruleId: CandlePatternRuleId, direction: SignalFinding["direction"], weight: number, evidence: Record<string, unknown>) => {
    candidates.push({ ruleId, ruleFamily: "CANDLE_PATTERN", direction, weight, evidence: { ...evidence, closedCandle: true, open: current.open, high: current.high, low: current.low, close: current.close } });
  };

  if (metrics.bodyRatio <= 0.1) add("DOJI_V1", "NEUTRAL", 0, { bodyRatio: metrics.bodyRatio });
  if (metrics.lowerShadow >= metrics.body * 2 && metrics.upperShadow <= Math.max(metrics.body, current.close * 0.0002) && metrics.bodyRatio <= 0.45) add("HAMMER_V1", "BULLISH", 0.06, { lowerShadow: metrics.lowerShadow, upperShadow: metrics.upperShadow });
  if (metrics.upperShadow >= metrics.body * 2 && metrics.lowerShadow <= Math.max(metrics.body, current.close * 0.0002) && metrics.bodyRatio <= 0.45) {
    const inverted = indicators.ema20 <= indicators.ema50;
    add(inverted ? "INVERTED_HAMMER_V1" : "SHOOTING_STAR_V1", inverted ? "BULLISH" : "BEARISH", 0.06, { upperShadow: metrics.upperShadow, lowerShadow: metrics.lowerShadow, ema20: indicators.ema20, ema50: indicators.ema50 });
  }
  if (metrics.lowerShadow >= metrics.body * 2 && metrics.upperShadow <= Math.max(metrics.body, current.close * 0.0002) && indicators.ema20 >= indicators.ema50) add("HANGING_MAN_V1", "BEARISH", 0.06, { lowerShadow: metrics.lowerShadow, upperShadow: metrics.upperShadow });
  if (metrics.bodyRatio <= 0.35 && metrics.upperShadow >= metrics.body && metrics.lowerShadow >= metrics.body) add("SPINNING_TOP_V1", "NEUTRAL", 0, { bodyRatio: metrics.bodyRatio });

  if (previous) {
    const previousMetrics = candleMetrics(previous);
    const currentLow = Math.min(current.open, current.close);
    const currentHigh = Math.max(current.open, current.close);
    const previousLow = Math.min(previous.open, previous.close);
    const previousHigh = Math.max(previous.open, previous.close);
    if (previousMetrics.bearish && metrics.bullish && currentLow <= previousLow && currentHigh >= previousHigh) add("BULLISH_ENGULFING_V1", "BULLISH", 0.15, { previousOpen: previous.open, previousClose: previous.close });
    if (previousMetrics.bullish && metrics.bearish && currentLow <= previousLow && currentHigh >= previousHigh) add("BEARISH_ENGULFING_V1", "BEARISH", 0.15, { previousOpen: previous.open, previousClose: previous.close });
    if (previousMetrics.bearish && metrics.bullish && currentLow >= previousLow && currentHigh <= previousHigh) add("BULLISH_HARAMI_V1", "BULLISH", 0.1, { previousOpen: previous.open, previousClose: previous.close });
    if (previousMetrics.bullish && metrics.bearish && currentLow >= previousLow && currentHigh <= previousHigh) add("BEARISH_HARAMI_V1", "BEARISH", 0.1, { previousOpen: previous.open, previousClose: previous.close });
    const proximity = Math.max(indicators.atr14 * 0.1, current.close * 0.0008);
    if (Math.abs(current.high - previous.high) <= proximity && previousMetrics.bullish && metrics.bearish) add("TWEEZER_TOP_V1", "BEARISH", 0.1, { previousHigh: previous.high, highDifference: Math.abs(current.high - previous.high) });
    if (Math.abs(current.low - previous.low) <= proximity && previousMetrics.bearish && metrics.bullish) add("TWEEZER_BOTTOM_V1", "BULLISH", 0.1, { previousLow: previous.low, lowDifference: Math.abs(current.low - previous.low) });
  }

  if (first && previous) {
    const firstMetrics = candleMetrics(first);
    const middleMetrics = candleMetrics(previous);
    const midpoint = (first.open + first.close) / 2;
    if (firstMetrics.bearish && middleMetrics.bodyRatio <= 0.45 && metrics.bullish && current.close > midpoint) add("MORNING_STAR_V1", "BULLISH", 0.15, { firstClose: first.close, midpoint, middleBodyRatio: middleMetrics.bodyRatio });
    if (firstMetrics.bullish && middleMetrics.bodyRatio <= 0.45 && metrics.bearish && current.close < midpoint) add("EVENING_STAR_V1", "BEARISH", 0.15, { firstClose: first.close, midpoint, middleBodyRatio: middleMetrics.bodyRatio });
    if (firstMetrics.bullish && middleMetrics.bullish && metrics.bullish && first.close < previous.close && previous.close < current.close) add("THREE_WHITE_SOLDIERS_V1", "BULLISH", 0.15, { firstClose: first.close, secondClose: previous.close });
    if (firstMetrics.bearish && middleMetrics.bearish && metrics.bearish && first.close > previous.close && previous.close > current.close) add("THREE_BLACK_CROWS_V1", "BEARISH", 0.15, { firstClose: first.close, secondClose: previous.close });
    const firstLow = Math.min(first.open, first.close);
    const firstHigh = Math.max(first.open, first.close);
    const middleLow = Math.min(previous.open, previous.close);
    const middleHigh = Math.max(previous.open, previous.close);
    if (firstMetrics.bearish && middleLow >= firstLow && middleHigh <= firstHigh && metrics.bullish && current.close > first.open) add("THREE_INSIDE_UP_V1", "BULLISH", 0.12, { firstOpen: first.open, confirmationClose: current.close });
    if (firstMetrics.bullish && middleLow >= firstLow && middleHigh <= firstHigh && metrics.bearish && current.close < first.open) add("THREE_INSIDE_DOWN_V1", "BEARISH", 0.12, { firstOpen: first.open, confirmationClose: current.close });
  }
  return candidates;
}

function calculateState(candles: Candle[], index: number, indicatorRows: IndicatorSet[], config: BotConfigView) {
  const candle = candles[index];
  const indicators = indicatorRows[index];
  const trailingVolume = candles.slice(Math.max(0, index - 20), index).map((prior) => prior.volume);
  const averageVolume = trailingVolume.reduce((sum, value) => sum + value, 0) / Math.max(1, trailingVolume.length);
  const trend = indicators.ema20 >= indicators.ema50 && indicators.ema50 >= indicators.ema200 ? 1 : indicators.ema20 <= indicators.ema50 && indicators.ema50 <= indicators.ema200 ? -1 : 0;
  const momentum = indicators.rsi14 >= 50 && indicators.macd >= indicators.macdSignal ? 1 : indicators.rsi14 <= 50 && indicators.macd <= indicators.macdSignal ? -1 : 0;
  const candleDirection = candle.close >= candle.open ? 1 : -1;
  const volumeSignal = averageVolume > 0 && candle.volume >= averageVolume ? candleDirection : 0;
  const range = candles.slice(Math.max(0, index - 20), index);
  const priorHigh = range.length ? Math.max(...range.map((prior) => prior.high)) : candle.high;
  const priorLow = range.length ? Math.min(...range.map((prior) => prior.low)) : candle.low;
  const candidates: Candidate[] = [];
  const addMethod = (ruleId: MethodologyRuleId, ruleFamily: Candidate["ruleFamily"], direction: SignalFinding["direction"], weight: number, evidence: Record<string, unknown>) => candidates.push({ ruleId, ruleFamily, direction, weight, evidence });
  if (trend) addMethod("EMA_TREND_V1", "TREND", trend > 0 ? "BULLISH" : "BEARISH", 0.3, { ema20: indicators.ema20, ema50: indicators.ema50, ema200: indicators.ema200, closedCandle: true });
  if (momentum) addMethod("RSI_MACD_CONFIRMATION_V1", "MOMENTUM", momentum > 0 ? "BULLISH" : "BEARISH", 0.2, { rsi14: indicators.rsi14, macd: indicators.macd, macdSignal: indicators.macdSignal, closedCandle: true });
  if (volumeSignal) addMethod("VOLUME_CONFIRMATION_V1", "VOLUME", volumeSignal > 0 ? "BULLISH" : "BEARISH", 0.1, { volume: candle.volume, averageVolume, relativeVolume: candle.volume / averageVolume, closedCandle: true });
  if (range.length >= 20 && candle.low < priorLow && candle.close > priorLow && volumeSignal > 0) addMethod("WYCKOFF_SPRING_PROXY_V1", "WYCKOFF", "BULLISH", 0.16, { priorLow, close: candle.close, volume: candle.volume, averageVolume, closedCandle: true });
  if (range.length >= 20 && candle.high > priorHigh && candle.close < priorHigh && volumeSignal < 0) addMethod("WYCKOFF_UPTHRUST_PROXY_V1", "WYCKOFF", "BEARISH", 0.16, { priorHigh, close: candle.close, volume: candle.volume, averageVolume, closedCandle: true });
  if (range.length >= 20 && candle.close > priorHigh && volumeSignal > 0) addMethod("SMC_BULLISH_BOS_PROXY_V1", "SMC", "BULLISH", 0.18, { priorHigh, close: candle.close, volume: candle.volume, averageVolume, closedCandle: true });
  if (range.length >= 20 && candle.close < priorLow && volumeSignal < 0) addMethod("SMC_BEARISH_BOS_PROXY_V1", "SMC", "BEARISH", 0.18, { priorLow, close: candle.close, volume: candle.volume, averageVolume, closedCandle: true });
  if (index >= 3 && candles[index - 3].close < candles[index - 2].close && candles[index - 2].close < candles[index - 1].close && candles[index - 1].close < candle.close && indicators.ema20 > indicators.ema50) addMethod("ELLIOTT_BULLISH_IMPULSE_PROXY_V1", "ELLIOTT_EXPERIMENTAL", "BULLISH", 0.12, { closes: candles.slice(index - 3, index + 1).map((item) => item.close), ema20: indicators.ema20, ema50: indicators.ema50, closedCandle: true });
  if (index >= 3 && candles[index - 3].close > candles[index - 2].close && candles[index - 2].close > candles[index - 1].close && candles[index - 1].close > candle.close && indicators.ema20 < indicators.ema50) addMethod("ELLIOTT_BEARISH_IMPULSE_PROXY_V1", "ELLIOTT_EXPERIMENTAL", "BEARISH", 0.12, { closes: candles.slice(index - 3, index + 1).map((item) => item.close), ema20: indicators.ema20, ema50: indicators.ema50, closedCandle: true });

  candidates.push(...buildPatternCandidates(candles, index, indicators));
  const selected = candidates.filter((candidate) => {
    if (!config.ruleFamilies.includes(candidate.ruleFamily as typeof config.ruleFamilies[number])) return false;
    return candidate.ruleFamily === "CANDLE_PATTERN"
      ? config.enabledPatterns.includes(candidate.ruleId as CandlePatternRuleId)
      : config.enabledMethodologies.includes(candidate.ruleId as MethodologyRuleId);
  });
  const rawScore = selected.reduce((score, candidate) => score + (candidate.direction === "BULLISH" ? candidate.weight : candidate.direction === "BEARISH" ? -candidate.weight : 0), 0);
  const score = Number(clamp(rawScore, -1, 1).toFixed(4));
  const state: SignalState = score >= config.alertThreshold ? "BULLISH_SETUP" : score <= -config.alertThreshold ? "BEARISH_SETUP" : "NEUTRAL";
  const confidence = Number(clamp(Math.abs(score) * 0.75 + (selected.length ? 0.25 : 0), 0, 1).toFixed(4));
  const direction = state === "BULLISH_SETUP" ? "BULLISH" : state === "BEARISH_SETUP" ? "BEARISH" : "NEUTRAL" as const;
  const findings: SignalFinding[] = selected.map((candidate) => ({ findingId: `public-${candle.closeTime}-${candidate.ruleId}`, ruleFamily: candidate.ruleFamily, ruleId: candidate.ruleId, direction: candidate.direction, strength: candidate.weight, evidence: candidate.evidence }));
  return { score, confidence, state, direction, findings, averageVolume };
}

export function parseClosedBinanceCandles(payload: unknown, now = Date.now()): Candle[] {
  if (!Array.isArray(payload)) throw new Error("Public candle source returned an invalid response");
  return payload
    .map((row): Candle | null => {
      if (!Array.isArray(row) || row.length < 6) return null;
      const [openTime, open, high, low, close, volume, closeTime] = row;
      const parsed = { openTime: Number(openTime), closeTime: Number(closeTime), open: Number(open), high: Number(high), low: Number(low), close: Number(close), volume: Number(volume) };
      return Object.values(parsed).every(Number.isFinite) && parsed.closeTime <= now ? parsed : null;
    })
    .filter((candle): candle is Candle => candle !== null)
    .sort((left, right) => left.closeTime - right.closeTime);
}

export function buildPublicResearchWindow(assetSymbol: string, timeframe: string, config: BotConfigView, candles: Candle[]) {
  if (candles.length < 210) throw new Error("Public source returned insufficient closed candles for EMA200 research");
  const indicators = calculateIndicators(candles);
  const latestIndex = candles.length - 1;
  const latest = candles[latestIndex];
  const latestIndicators = indicators[latestIndex];
  const state = calculateState(candles, latestIndex, indicators, config);
  const sourceManifestId = `public-${randomUUID()}`;
  const history: CandlePointInput[] = candles.map((candle, index) => {
    const pointState = calculateState(candles, index, indicators, config);
    return {
      id: `binance-${assetSymbol.replace("/", "-")}-${timeframe}-${candle.closeTime}`,
      assetSymbol, venue: "BINANCE_PUBLIC", timeframe, candleCloseTime: iso(candle.closeTime),
      open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume,
      ...indicators[index], signalState: pointState.state, signalScore: pointState.score,
      strategyVersion: STRATEGY_VERSION, configVersion: config.configVersion,
    };
  });
  const snapshot: SignalSnapshotInput = {
    id: `public-${assetSymbol.replace("/", "-")}-${timeframe}-${latest.closeTime}`,
    assetSymbol, venue: "BINANCE_PUBLIC", timeframe, candleCloseTime: iso(latest.closeTime),
    state: state.state, score: state.score, confidence: state.confidence,
    regime: latestIndicators.ema20 >= latestIndicators.ema50 ? "UPTREND" : "DOWNTREND",
    dataQualityState: "PUBLIC_CLOSED_CANDLES", findings: state.findings,
    conflicts: state.findings.some((finding) => finding.direction === "BULLISH") && state.findings.some((finding) => finding.direction === "BEARISH") ? ["MIXED_EVIDENCE"] : [],
    invalidation: { researchOnly: true, close: latest.close, atr14: latestIndicators.atr14, averageVolume: state.averageVolume },
    strategyVersion: STRATEGY_VERSION, configVersion: config.configVersion, sourceManifestId,
  };
  return { history, snapshot };
}

async function fetchPublicClosedCandles(assetSymbol: string, timeframe: string) {
  const url = new URL(PUBLIC_BINANCE_BASE_URL);
  url.searchParams.set("symbol", toBinanceSymbol(assetSymbol));
  url.searchParams.set("interval", timeframe);
  url.searchParams.set("limit", "240");
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Public candle source failed (${response.status})`);
  return parseClosedBinanceCandles(await response.json());
}

export async function refreshPublicCandleResearch(input: { assetSymbol: string; timeframe: string }) {
  const config = await getBotConfig();
  const runId = `dashboard-${randomUUID()}`;
  const startedAt = new Date();
  await recordRunnerHealth({ runId, state: "RUNNING", configVersion: config.configVersion, startedAt, finishedAt: null, cycleCount: 0, failureCount: 0, lastError: null, summary: { trigger: "DASHBOARD_PUBLIC_REFRESH", ...input } });
  try {
    if (config.isPaused) {
      await recordRunnerHealth({ runId, state: "PAUSED", configVersion: config.configVersion, startedAt, finishedAt: new Date(), cycleCount: 0, failureCount: 0, lastError: null, summary: { trigger: "DASHBOARD_PUBLIC_REFRESH", reason: "PAUSED" } });
      return { ok: true as const, paused: true as const, cycleCount: 0, state: "PAUSED" as const };
    }
    const candles = await fetchPublicClosedCandles(input.assetSymbol, input.timeframe);
    const result = buildPublicResearchWindow(input.assetSymbol, input.timeframe, config, candles);
    const candleResult = await recordCandleHistory(result.history);
    const signalResult = await recordSignalSnapshot(result.snapshot);
    const summary = { trigger: "DASHBOARD_PUBLIC_REFRESH", assetSymbol: input.assetSymbol, timeframe: input.timeframe, candlesRecorded: candleResult.recorded, signalState: result.snapshot.state, signalScore: result.snapshot.score, dataSource: "BINANCE_PUBLIC" };
    await recordRunnerHealth({ runId, state: "SUCCESS", configVersion: config.configVersion, startedAt, finishedAt: new Date(), cycleCount: 1, failureCount: 0, lastError: null, summary });
    await recordAuditEvent("DASHBOARD_PUBLIC_CANDLE_REFRESH", "DASHBOARD", "dashboard", summary);
    return { ok: true as const, paused: false as const, cycleCount: 1, state: "SUCCESS" as const, candlesRecorded: candleResult.recorded, snapshot: signalResult.snapshot };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Public candle refresh failed";
    await recordRunnerHealth({ runId, state: "DEGRADED", configVersion: config.configVersion, startedAt, finishedAt: new Date(), cycleCount: 0, failureCount: 1, lastError: message, summary: { trigger: "DASHBOARD_PUBLIC_REFRESH", ...input } });
    await recordAuditEvent("DASHBOARD_PUBLIC_CANDLE_REFRESH_FAILED", "DASHBOARD", "dashboard", { ...input, error: message });
    throw new Error(message);
  }
}
