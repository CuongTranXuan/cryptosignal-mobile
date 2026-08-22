import { and, asc, desc, eq, gt, gte } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditEvents,
  botConfigs,
  candleHistory,
  dashboardCredentials,
  dashboardSessions,
  InsertUser,
  liveObservations,
  marketArchiveManifests,
  marketPipelineHealth,
  runnerHealth,
  signalSnapshots,
  telegramPollingState,
  users,
} from "../drizzle/schema";
import { DEFAULT_LIVE_ALERT_CONFIG, LIVE_CONDITION_IDS, type LiveAlertConfig, type LiveObservation, type MarketComponentHealth } from "../shared/live-market-types";
import { CANDLE_PATTERN_RULE_IDS, METHODOLOGY_RULE_IDS, type AuditEventView, type BotConfigView, type CandlePatternRuleId, type CandlePointInput, type ConditionalScenario, type MethodologyRuleId, type RuleFamilyId, type RunnerHealthState, type RunnerHealthView, type SignalSnapshotInput } from "../shared/signal-types";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export const DEFAULT_BOT_CONFIG: BotConfigView = {
  configVersion: 1,
  lastChangedBy: "SYSTEM",
  isPaused: false,
  watchlist: ["BTC/USDT", "ETH/USDT", "BNB/USDT"],
  timeframes: ["30m", "1h", "4h"],
  ruleFamilies: ["TREND", "MOMENTUM", "VOLUME", "CANDLE_PATTERN"],
  enabledPatterns: [...CANDLE_PATTERN_RULE_IDS] as CandlePatternRuleId[],
  enabledMethodologies: [...METHODOLOGY_RULE_IDS] as MethodologyRuleId[],
  liveAlerts: { ...DEFAULT_LIVE_ALERT_CONFIG },
  alertThreshold: 0.55,
  cooldownMinutes: 60,
  quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
};

export const DEFAULT_RUNNER_HEALTH: RunnerHealthView = {
  runId: null,
  state: "IDLE",
  configVersion: null,
  startedAt: null,
  finishedAt: null,
  cycleCount: 0,
  failureCount: 0,
  lastError: null,
  summary: {},
  updatedAt: null,
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function parseEnabledPatterns(value: string | null | undefined): CandlePatternRuleId[] {
  const parsed = parseJson<string[]>(value ?? "", DEFAULT_BOT_CONFIG.enabledPatterns);
  const allowed = new Set<string>(CANDLE_PATTERN_RULE_IDS);
  const filtered = parsed.filter((ruleId): ruleId is CandlePatternRuleId => allowed.has(ruleId));
  return filtered.length ? filtered : [...DEFAULT_BOT_CONFIG.enabledPatterns];
}

function parseEnabledMethodologies(value: string | null | undefined): MethodologyRuleId[] {
  const parsed = parseJson<string[]>(value ?? "", DEFAULT_BOT_CONFIG.enabledMethodologies);
  const allowed = new Set<string>(METHODOLOGY_RULE_IDS);
  const filtered = parsed.filter((ruleId): ruleId is MethodologyRuleId => allowed.has(ruleId));
  return filtered.length ? filtered : [...DEFAULT_BOT_CONFIG.enabledMethodologies];
}

export function parseLiveAlerts(value: string | null | undefined): LiveAlertConfig {
  const parsed = parseJson<Partial<LiveAlertConfig>>(value ?? "", DEFAULT_LIVE_ALERT_CONFIG);
  const allowed = new Set<string>(LIVE_CONDITION_IDS);
  const rawConditionIds = parsed.conditionIds ?? [];
  const conditionIds = rawConditionIds.filter((conditionId): conditionId is LiveAlertConfig["conditionIds"][number] => allowed.has(conditionId));
  const parsedThreshold = parsed.threshold;
  const thresholdIsValid = typeof parsedThreshold === "number" && Number.isFinite(parsedThreshold) && parsedThreshold >= 0 && parsedThreshold <= 1;
  const parsedCooldownMinutes = parsed.cooldownMinutes;
  const cooldownIsValid = typeof parsedCooldownMinutes === "number" && Number.isInteger(parsedCooldownMinutes) && parsedCooldownMinutes >= 1 && parsedCooldownMinutes <= 1440;
  const idsAreValid = rawConditionIds.length === conditionIds.length;
  const enabledWithoutConditions = parsed.enabled === true && conditionIds.length === 0;
  if (!idsAreValid || !thresholdIsValid || !cooldownIsValid || enabledWithoutConditions) return { ...DEFAULT_LIVE_ALERT_CONFIG };
  return { enabled: parsed.enabled === true, conditionIds, threshold: parsedThreshold, cooldownMinutes: parsedCooldownMinutes };
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;

  const values: InsertUser = { openId: user.openId, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { lastSignedIn: values.lastSignedIn };
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = values[field];
    }
  }
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function getBotConfig(): Promise<BotConfigView> {
  const db = await getDb();
  if (!db) return DEFAULT_BOT_CONFIG;
  const rows = await db.select().from(botConfigs).where(eq(botConfigs.id, 1)).limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_BOT_CONFIG;
  const recentChanges = await db
    .select({ actorType: auditEvents.actorType })
    .from(auditEvents)
    .where(eq(auditEvents.action, "BOT_CONFIGURATION_CHANGED"))
    .orderBy(desc(auditEvents.createdAt))
    .limit(1);
  const actorType = recentChanges[0]?.actorType;
  const lastChangedBy = actorType === "DASHBOARD" || actorType === "TELEGRAM" ? actorType : "SYSTEM";
  return {
    configVersion: row.configVersion,
    lastChangedBy,
    isPaused: row.isPaused,
    watchlist: parseJson(row.watchlistJson, DEFAULT_BOT_CONFIG.watchlist),
    timeframes: parseJson(row.timeframesJson, DEFAULT_BOT_CONFIG.timeframes),
    ruleFamilies: parseJson<RuleFamilyId[]>(row.ruleFamiliesJson, DEFAULT_BOT_CONFIG.ruleFamilies),
    enabledPatterns: parseEnabledPatterns(row.enabledPatternsJson),
    enabledMethodologies: parseEnabledMethodologies(row.enabledMethodologiesJson),
    liveAlerts: parseLiveAlerts(row.liveAlertsJson),
    alertThreshold: row.alertThreshold,
    cooldownMinutes: row.cooldownMinutes,
    quietHours: parseJson(row.quietHoursJson, DEFAULT_BOT_CONFIG.quietHours),
  };
}

export type DashboardUser = { id: number; username: string; role: "user" | "admin" };

export async function countDashboardCredentials() {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const rows = await db.select({ id: dashboardCredentials.id }).from(dashboardCredentials).limit(1);
  return rows.length;
}

export async function getDashboardCredential(username: string) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const rows = await db.select().from(dashboardCredentials).where(eq(dashboardCredentials.username, username)).limit(1);
  return rows[0] ?? null;
}

export async function createDashboardCredential(username: string, passwordHash: string, role: "user" | "admin") {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const result = await db.insert(dashboardCredentials).values({ username, passwordHash, role });
  return Number(result[0].insertId);
}

export async function createDashboardSession(credentialId: number, tokenHash: string, expiresAt: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database is unavailable");
  const id = crypto.randomUUID();
  await db.insert(dashboardSessions).values({ id, credentialId, tokenHash, expiresAt, lastSeenAt: new Date() });
  await db.update(dashboardCredentials).set({ lastSignedIn: new Date() }).where(eq(dashboardCredentials.id, credentialId));
  return id;
}

export async function getDashboardUserBySessionHash(tokenHash: string): Promise<DashboardUser | null> {
  const db = await getDb();
  if (!db) return null;
  const rows = await db
    .select({ id: dashboardCredentials.id, username: dashboardCredentials.username, role: dashboardCredentials.role })
    .from(dashboardSessions)
    .innerJoin(dashboardCredentials, eq(dashboardSessions.credentialId, dashboardCredentials.id))
    .where(and(eq(dashboardSessions.tokenHash, tokenHash), gt(dashboardSessions.expiresAt, new Date())))
    .limit(1);
  if (!rows[0]) return null;
  await db.update(dashboardSessions).set({ lastSeenAt: new Date() }).where(eq(dashboardSessions.tokenHash, tokenHash));
  return rows[0];
}

export async function deleteDashboardSession(tokenHash: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(dashboardSessions).where(eq(dashboardSessions.tokenHash, tokenHash));
}

export async function setBotPaused(isPaused: boolean, actorId: string, actorType: "TELEGRAM" | "DASHBOARD" = "TELEGRAM"): Promise<BotConfigView> {
  const current = await getBotConfig();
  return updateBotConfig({ isPaused }, actorId, current, actorType);
}

export async function updateBotConfig(
  patch: Partial<Omit<BotConfigView, "configVersion" | "lastChangedBy">>,
  actorId: string,
  currentConfig?: BotConfigView,
  actorType = "TELEGRAM",
): Promise<BotConfigView> {
  const db = await getDb();
  const current = currentConfig ?? (await getBotConfig());
  const next = { ...current, ...patch, configVersion: current.configVersion + 1, lastChangedBy: actorType === "DASHBOARD" ? "DASHBOARD" as const : "TELEGRAM" as const };
  if (!db) return next;
  await db
    .insert(botConfigs)
    .values({
      id: 1,
      configVersion: next.configVersion,
      isPaused: next.isPaused,
      watchlistJson: JSON.stringify(next.watchlist),
      timeframesJson: JSON.stringify(next.timeframes),
      ruleFamiliesJson: JSON.stringify(next.ruleFamilies),
      enabledPatternsJson: JSON.stringify(next.enabledPatterns),
      enabledMethodologiesJson: JSON.stringify(next.enabledMethodologies),
      liveAlertsJson: JSON.stringify(next.liveAlerts),
      alertThreshold: next.alertThreshold,
      cooldownMinutes: next.cooldownMinutes,
      quietHoursJson: JSON.stringify(next.quietHours),
    })
    .onDuplicateKeyUpdate({
      set: {
        configVersion: next.configVersion,
        isPaused: next.isPaused,
        watchlistJson: JSON.stringify(next.watchlist),
        timeframesJson: JSON.stringify(next.timeframes),
        ruleFamiliesJson: JSON.stringify(next.ruleFamilies),
        enabledPatternsJson: JSON.stringify(next.enabledPatterns),
        enabledMethodologiesJson: JSON.stringify(next.enabledMethodologies),
        liveAlertsJson: JSON.stringify(next.liveAlerts),
        alertThreshold: next.alertThreshold,
        cooldownMinutes: next.cooldownMinutes,
        quietHoursJson: JSON.stringify(next.quietHours),
      },
    });
  await recordAuditEvent("BOT_CONFIGURATION_CHANGED", actorType, actorId, { patch, configVersion: next.configVersion });
  return next;
}

export async function recordSignalSnapshot(input: SignalSnapshotInput) {
  const db = await getDb();
  if (!db) return { snapshot: input, isNew: true };
  const existing = await db
    .select({ id: signalSnapshots.id })
    .from(signalSnapshots)
    .where(eq(signalSnapshots.id, input.id))
    .limit(1);
  if (existing.length > 0) return { snapshot: input, isNew: false };
  await db
    .insert(signalSnapshots)
    .values({
      id: input.id,
      assetSymbol: input.assetSymbol,
      venue: input.venue,
      timeframe: input.timeframe,
      candleCloseTime: new Date(input.candleCloseTime),
      state: input.state,
      score: input.score,
      confidence: input.confidence,
      regime: input.regime,
      dataQualityState: input.dataQualityState,
      findingsJson: JSON.stringify(input.findings),
      conflictsJson: JSON.stringify(input.conflicts),
      invalidationJson: JSON.stringify(input.invalidation),
      strategyVersion: input.strategyVersion,
      configVersion: input.configVersion,
      sourceManifestId: input.sourceManifestId,
    });
  await recordAuditEvent("SIGNAL_RECORDED", "ENGINE", "freqtrade", { signalId: input.id });
  return { snapshot: input, isNew: true };
}

export async function listSignalSnapshots(limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(signalSnapshots).orderBy(desc(signalSnapshots.candleCloseTime)).limit(limit);
  return rows.map((row) => ({
    ...row,
    findings: parseJson(row.findingsJson, []),
    conflicts: parseJson(row.conflictsJson, []),
    invalidation: parseJson(row.invalidationJson, {}),
  }));
}

export async function recordCandleHistory(candles: CandlePointInput[]) {
  const db = await getDb();
  if (!db || candles.length === 0) return { recorded: candles.length };
  await db
    .insert(candleHistory)
    .values(candles.map((candle) => ({ ...candle, candleCloseTime: new Date(candle.candleCloseTime) })))
    .onDuplicateKeyUpdate({
      set: {
        open: sql`VALUES(${candleHistory.open})`, high: sql`VALUES(${candleHistory.high})`, low: sql`VALUES(${candleHistory.low})`, close: sql`VALUES(${candleHistory.close})`, volume: sql`VALUES(${candleHistory.volume})`,
        ema20: sql`VALUES(${candleHistory.ema20})`, ema50: sql`VALUES(${candleHistory.ema50})`, ema200: sql`VALUES(${candleHistory.ema200})`, rsi14: sql`VALUES(${candleHistory.rsi14})`,
        macd: sql`VALUES(${candleHistory.macd})`, macdSignal: sql`VALUES(${candleHistory.macdSignal})`, atr14: sql`VALUES(${candleHistory.atr14})`,
        signalState: sql`VALUES(${candleHistory.signalState})`, signalScore: sql`VALUES(${candleHistory.signalScore})`,
        strategyVersion: sql`VALUES(${candleHistory.strategyVersion})`, configVersion: sql`VALUES(${candleHistory.configVersion})`,
      },
    });
  return { recorded: candles.length };
}

function formatPrice(value: number) {
  return value >= 100 ? value.toFixed(2) : value.toFixed(4);
}

export function buildConditionalScenarios(
  latest: { close: number; atr14: number; ema20: number; ema50: number; rsi14: number; signalState: string; signalScore: number },
  timeframe: string,
): ConditionalScenario[] {
  const band = Math.max(Math.abs(latest.atr14), latest.close * 0.0025);
  const lower = Number((latest.close - band).toFixed(6));
  const upper = Number((latest.close + band).toFixed(6));
  const upEvidence = latest.ema20 >= latest.ema50;
  const shared = { researchWindow: `Next 1–3 completed ${timeframe} candles`, observedVolatilityBand: { lower, upper } };
  return [
    {
      id: "BULLISH_CONTINUATION", label: "Bullish-continuation condition",
      condition: upEvidence
        ? `A completed candle holds above ${formatPrice(latest.ema20)} with non-conflicted momentum.`
        : `A completed candle reclaims ${formatPrice(latest.ema20)} with confirming momentum; current structure does not establish this.`,
      invalidation: `A completed candle below ${formatPrice(lower)} weakens this condition.`,
      ...shared,
      evidence: [`EMA20 is ${upEvidence ? "above" : "below"} EMA50`, `RSI14 ${latest.rsi14.toFixed(1)}`, `Research score ${latest.signalScore.toFixed(2)}`],
    },
    {
      id: "BEARISH_CONTINUATION", label: "Bearish-continuation condition",
      condition: !upEvidence
        ? `A completed candle remains below ${formatPrice(latest.ema20)} with non-conflicted momentum.`
        : `A completed candle loses ${formatPrice(latest.ema20)} with confirming momentum; current structure does not establish this.`,
      invalidation: `A completed candle above ${formatPrice(upper)} weakens this condition.`,
      ...shared,
      evidence: [`EMA20 is ${upEvidence ? "above" : "below"} EMA50`, `RSI14 ${latest.rsi14.toFixed(1)}`, `Research score ${latest.signalScore.toFixed(2)}`],
    },
    {
      id: "RANGE_OR_REVERSAL", label: "Range or reversal condition",
      condition: `Price remains between ${formatPrice(lower)} and ${formatPrice(upper)} while independent directional evidence is incomplete or conflicts.`,
      invalidation: "A completed-candle break with independent confirmation resolves this condition.",
      ...shared,
      evidence: ["Observed ATR volatility band only; not a price forecast.", `Current research state ${latest.signalState.replaceAll("_", " ")}`],
    },
  ];
}

export async function getChartWindow(assetSymbol: string, timeframe: string, limit = 120) {
  const db = await getDb();
  if (!db) return { candles: [], signals: [], scenarios: [] as ConditionalScenario[] };
  const newestFirst = await db
    .select()
    .from(candleHistory)
    .where(and(eq(candleHistory.assetSymbol, assetSymbol), eq(candleHistory.timeframe, timeframe)))
    .orderBy(desc(candleHistory.candleCloseTime))
    .limit(limit);
  const candles = newestFirst.reverse();
  if (candles.length === 0) return { candles, signals: [], scenarios: [] as ConditionalScenario[] };
  const signals = await db
    .select()
    .from(signalSnapshots)
    .where(and(eq(signalSnapshots.assetSymbol, assetSymbol), eq(signalSnapshots.timeframe, timeframe), gte(signalSnapshots.candleCloseTime, candles[0].candleCloseTime)))
    .orderBy(asc(signalSnapshots.candleCloseTime));
  const latest = candles[candles.length - 1];
  return {
    candles,
    signals: signals.map((signal) => ({ ...signal, findings: parseJson(signal.findingsJson, []), conflicts: parseJson(signal.conflictsJson, []) })),
    scenarios: buildConditionalScenarios(latest, timeframe),
  };
}

export async function recordAuditEvent(action: string, actorType: string, actorId: string, payload: unknown) {
  const db = await getDb();
  if (!db) return;
  await db.insert(auditEvents).values({
    id: crypto.randomUUID(),
    action,
    actorType,
    actorId,
    payloadJson: JSON.stringify(payload),
  });
}

export async function listAuditEvents(limit = 30): Promise<AuditEventView[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(auditEvents).orderBy(desc(auditEvents.createdAt)).limit(limit);
  return rows.map((row) => ({
    id: row.id,
    action: row.action,
    actorType: row.actorType,
    actorId: row.actorId,
    payload: parseJson<Record<string, unknown>>(row.payloadJson, {}),
    createdAt: row.createdAt,
  }));
}

export async function getRunnerHealth(): Promise<RunnerHealthView> {
  const db = await getDb();
  if (!db) return DEFAULT_RUNNER_HEALTH;
  const rows = await db.select().from(runnerHealth).where(eq(runnerHealth.id, 1)).limit(1);
  const row = rows[0];
  if (!row) return DEFAULT_RUNNER_HEALTH;
  return {
    runId: row.runId ?? null,
    state: row.state as RunnerHealthState,
    configVersion: row.configVersion ?? null,
    startedAt: row.startedAt ?? null,
    finishedAt: row.finishedAt ?? null,
    cycleCount: row.cycleCount,
    failureCount: row.failureCount,
    lastError: row.lastError ?? null,
    summary: parseJson<Record<string, unknown>>(row.summaryJson, {}),
    updatedAt: row.updatedAt ?? null,
  };
}

export type RunnerHealthUpdate = Omit<RunnerHealthView, "updatedAt">;

export async function recordRunnerHealth(update: RunnerHealthUpdate): Promise<RunnerHealthView> {
  const db = await getDb();
  if (!db) return { ...update, updatedAt: new Date() };
  await db
    .insert(runnerHealth)
    .values({
      id: 1,
      runId: update.runId,
      state: update.state,
      configVersion: update.configVersion,
      startedAt: update.startedAt,
      finishedAt: update.finishedAt,
      cycleCount: update.cycleCount,
      failureCount: update.failureCount,
      lastError: update.lastError,
      summaryJson: JSON.stringify(update.summary),
    })
    .onDuplicateKeyUpdate({
      set: {
        runId: update.runId,
        state: update.state,
        configVersion: update.configVersion,
        startedAt: update.startedAt,
        finishedAt: update.finishedAt,
        cycleCount: update.cycleCount,
        failureCount: update.failureCount,
        lastError: update.lastError,
        summaryJson: JSON.stringify(update.summary),
      },
    });
  if (update.state !== "RUNNING") {
    await recordAuditEvent("RUNNER_CYCLE_REPORTED", "ENGINE", "freqtrade", {
      runId: update.runId,
      state: update.state,
      configVersion: update.configVersion,
      cycleCount: update.cycleCount,
      failureCount: update.failureCount,
      lastError: update.lastError,
    });
  }
  return { ...update, updatedAt: new Date() };
}

export async function hasRecentSignalAlert(alertKey: string, cooldownMinutes: number) {
  const db = await getDb();
  if (!db) return false;
  const candidates = await db
    .select()
    .from(auditEvents)
    .where(eq(auditEvents.action, "SIGNAL_ALERT_SENT"))
    .orderBy(desc(auditEvents.createdAt))
    .limit(50);
  const cutoff = Date.now() - cooldownMinutes * 60_000;
  return candidates.some((event) => {
    const payload = parseJson<{ alertKey?: string }>(event.payloadJson, {});
    return payload.alertKey === alertKey && event.createdAt.getTime() >= cutoff;
  });
}

export async function recordLiveObservation(input: LiveObservation) {
  const db = await getDb();
  if (!db) return { observation: input, isNew: true };
  const existing = await db.select({ id: liveObservations.id }).from(liveObservations).where(eq(liveObservations.id, input.id)).limit(1);
  if (existing.length > 0) return { observation: input, isNew: false };
  await db.insert(liveObservations).values({
    id: input.id,
    assetSymbol: input.assetSymbol,
    observedAt: new Date(input.observedAt),
    conditionId: input.conditionId,
    direction: input.direction,
    score: input.score,
    dataQualityState: input.dataQualityState,
    evidenceJson: JSON.stringify(input.evidence),
    sourceEventIdsJson: JSON.stringify(input.sourceEventIds),
    configVersion: input.configVersion,
  });
  await recordAuditEvent("LIVE_OBSERVATION_RECORDED", "MARKET_EVALUATOR", "live-evaluator", {
    observationId: input.id,
    assetSymbol: input.assetSymbol,
    conditionId: input.conditionId,
    direction: input.direction,
    score: input.score,
    observedAt: input.observedAt,
    configVersion: input.configVersion,
  });
  return { observation: input, isNew: true };
}

export async function listLiveObservations(limit = 30) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(liveObservations).orderBy(desc(liveObservations.observedAt)).limit(limit);
  return rows.map((row) => ({
    ...row,
    evidence: parseJson<Record<string, number | string | boolean>>(row.evidenceJson, {}),
    sourceEventIds: parseJson<string[]>(row.sourceEventIdsJson, []),
  }));
}

export type MarketPipelineHealthUpdate = Omit<MarketComponentHealth, "updatedAt">;

export async function getMarketPipelineHealth(): Promise<MarketComponentHealth[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(marketPipelineHealth).orderBy(asc(marketPipelineHealth.component));
  return rows.map((row) => ({
    component: row.component as MarketComponentHealth["component"],
    state: row.state as MarketComponentHealth["state"],
    lastSuccessAt: row.lastSuccessAt ?? null,
    lastError: row.lastError ?? null,
    lagMs: row.lagMs ?? null,
    summary: parseJson<Record<string, unknown>>(row.summaryJson, {}),
    updatedAt: row.updatedAt ?? null,
  }));
}

export async function recordMarketPipelineHealth(update: MarketPipelineHealthUpdate): Promise<MarketComponentHealth> {
  const db = await getDb();
  if (!db) return { ...update, updatedAt: new Date() };
  await db.insert(marketPipelineHealth).values({
    component: update.component,
    state: update.state,
    lastSuccessAt: update.lastSuccessAt,
    lastError: update.lastError,
    lagMs: update.lagMs,
    summaryJson: JSON.stringify(update.summary),
  }).onDuplicateKeyUpdate({
    set: {
      state: update.state,
      lastSuccessAt: update.lastSuccessAt,
      lastError: update.lastError,
      lagMs: update.lagMs,
      summaryJson: JSON.stringify(update.summary),
    },
  });
  if (update.state !== "RUNNING") {
    await recordAuditEvent("MARKET_PIPELINE_HEALTH_REPORTED", "MARKET_PIPELINE", update.component, {
      component: update.component,
      state: update.state,
      lagMs: update.lagMs,
      lastError: update.lastError,
    });
  }
  return { ...update, updatedAt: new Date() };
}

export type MarketArchiveManifestInput = {
  id: string;
  streamType: string;
  assetSymbol: string;
  partitionStart: Date;
  partitionEnd: Date;
  objectKey: string;
  rowCount: number;
  sha256: string;
  clickhouseBatchId: string;
  state: string;
};

export async function recordMarketArchiveManifest(input: MarketArchiveManifestInput) {
  const db = await getDb();
  if (!db) return input;
  await db.insert(marketArchiveManifests).values(input).onDuplicateKeyUpdate({
    set: {
      rowCount: input.rowCount,
      sha256: input.sha256,
      clickhouseBatchId: input.clickhouseBatchId,
      state: input.state,
    },
  });
  return input;
}

export async function hasRecentLiveAlert(alertKey: string, cooldownMinutes: number) {
  const db = await getDb();
  if (!db) return false;
  const candidates = await db.select().from(auditEvents).where(eq(auditEvents.action, "LIVE_OBSERVATION_ALERT_SENT")).orderBy(desc(auditEvents.createdAt)).limit(50);
  const cutoff = Date.now() - cooldownMinutes * 60_000;
  return candidates.some((event) => {
    const payload = parseJson<{ alertKey?: string }>(event.payloadJson, {});
    return payload.alertKey === alertKey && event.createdAt.getTime() >= cutoff;
  });
}

export async function getTelegramUpdateOffset() {
  const db = await getDb();
  if (!db) return 0;
  const rows = await db.select().from(telegramPollingState).where(eq(telegramPollingState.id, 1)).limit(1);
  return rows[0]?.updateOffset ?? 0;
}

export async function setTelegramUpdateOffset(updateOffset: number) {
  const db = await getDb();
  if (!db) return;
  await db
    .insert(telegramPollingState)
    .values({ id: 1, updateOffset, lastPolledAt: new Date() })
    .onDuplicateKeyUpdate({ set: { updateOffset, lastPolledAt: new Date() } });
}
