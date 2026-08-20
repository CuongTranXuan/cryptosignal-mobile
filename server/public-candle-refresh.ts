import { randomUUID } from "node:crypto";

import type { BotConfigView, CandlePointInput, SignalFinding, SignalSnapshotInput, SignalState } from "../shared/signal-types";
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

function calculateState(candle: Candle, indicators: IndicatorSet, trailingVolume: number[], config: BotConfigView) {
  const averageVolume = trailingVolume.reduce((sum, value) => sum + value, 0) / Math.max(1, trailingVolume.length);
  const trend = indicators.ema20 >= indicators.ema50 ? 1 : -1;
  const momentum = indicators.rsi14 >= 55 ? 1 : indicators.rsi14 <= 45 ? -1 : 0;
  const candleDirection = candle.close >= candle.open ? 1 : -1;
  const volumeSignal = candle.volume >= averageVolume * 1.15 ? candleDirection : 0;
  const rawScore = trend * 0.42 + momentum * 0.28 + candleDirection * 0.16 + volumeSignal * 0.14;
  const score = Number(clamp(rawScore, -1, 1).toFixed(4));
  const state: SignalState = score >= config.alertThreshold ? "BULLISH_SETUP" : score <= -config.alertThreshold ? "BEARISH_SETUP" : "NEUTRAL";
  const confidence = Number(clamp(Math.abs(score) * 0.75 + 0.25, 0, 1).toFixed(4));
  const direction = state === "BULLISH_SETUP" ? "BULLISH" : state === "BEARISH_SETUP" ? "BEARISH" : "NEUTRAL" as const;
  const findings: SignalFinding[] = [];
  if (config.ruleFamilies.includes("TREND")) findings.push({ findingId: "ema-trend", ruleFamily: "TREND", ruleId: "EMA20_EMA50", direction: trend > 0 ? "BULLISH" : "BEARISH", strength: 0.42, evidence: { ema20: indicators.ema20, ema50: indicators.ema50 } });
  if (config.ruleFamilies.includes("MOMENTUM")) findings.push({ findingId: "rsi-momentum", ruleFamily: "MOMENTUM", ruleId: "RSI14", direction: momentum > 0 ? "BULLISH" : momentum < 0 ? "BEARISH" : "NEUTRAL", strength: Number(Math.abs(indicators.rsi14 - 50) / 50), evidence: { rsi14: indicators.rsi14, macd: indicators.macd, macdSignal: indicators.macdSignal } });
  if (config.ruleFamilies.includes("VOLUME")) findings.push({ findingId: "relative-volume", ruleFamily: "VOLUME", ruleId: "VOLUME_AVERAGE", direction: volumeSignal > 0 ? "BULLISH" : volumeSignal < 0 ? "BEARISH" : "NEUTRAL", strength: Number(clamp(candle.volume / Math.max(averageVolume, 1), 0, 2) / 2), evidence: { volume: candle.volume, averageVolume } });
  if (config.ruleFamilies.includes("CANDLE_PATTERN")) findings.push({ findingId: "closed-candle-body", ruleFamily: "CANDLE_PATTERN", ruleId: "CLOSED_BODY_DIRECTION", direction: candleDirection > 0 ? "BULLISH" : "BEARISH", strength: Number(clamp(Math.abs(candle.close - candle.open) / Math.max(candle.high - candle.low, Number.EPSILON), 0, 1)), evidence: { open: candle.open, high: candle.high, low: candle.low, close: candle.close } });
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
  const state = calculateState(latest, latestIndicators, candles.slice(Math.max(0, latestIndex - 20), latestIndex).map((candle) => candle.volume), config);
  const sourceManifestId = `public-${randomUUID()}`;
  const history: CandlePointInput[] = candles.map((candle, index) => {
    const pointState = calculateState(candle, indicators[index], candles.slice(Math.max(0, index - 20), index).map((prior) => prior.volume), config);
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
