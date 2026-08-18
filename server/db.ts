import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import {
  auditEvents,
  botConfigs,
  InsertUser,
  signalSnapshots,
  telegramPollingState,
  users,
} from "../drizzle/schema";
import type { BotConfigView, SignalSnapshotInput } from "../shared/signal-types";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export const DEFAULT_BOT_CONFIG: BotConfigView = {
  configVersion: 1,
  isPaused: false,
  watchlist: ["BTC/USDT", "ETH/USDT", "BNB/USDT"],
  timeframes: ["1h", "4h"],
  ruleFamilies: ["TREND", "MOMENTUM", "VOLUME", "CANDLE_PATTERN"],
  alertThreshold: 0.55,
  cooldownMinutes: 60,
  quietHours: { start: "22:00", end: "07:00", timezone: "UTC" },
};

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
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
  return {
    configVersion: row.configVersion,
    isPaused: row.isPaused,
    watchlist: parseJson(row.watchlistJson, DEFAULT_BOT_CONFIG.watchlist),
    timeframes: parseJson(row.timeframesJson, DEFAULT_BOT_CONFIG.timeframes),
    ruleFamilies: parseJson(row.ruleFamiliesJson, DEFAULT_BOT_CONFIG.ruleFamilies),
    alertThreshold: row.alertThreshold,
    cooldownMinutes: row.cooldownMinutes,
    quietHours: parseJson(row.quietHoursJson, DEFAULT_BOT_CONFIG.quietHours),
  };
}

export async function setBotPaused(isPaused: boolean, actorId: string): Promise<BotConfigView> {
  const current = await getBotConfig();
  return updateBotConfig({ isPaused }, actorId, current);
}

export async function updateBotConfig(
  patch: Partial<Omit<BotConfigView, "configVersion">>,
  actorId: string,
  currentConfig?: BotConfigView,
): Promise<BotConfigView> {
  const db = await getDb();
  const current = currentConfig ?? (await getBotConfig());
  const next = { ...current, ...patch, configVersion: current.configVersion + 1 };
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
      alertThreshold: next.alertThreshold,
      cooldownMinutes: next.cooldownMinutes,
      quietHoursJson: JSON.stringify(next.quietHours),
    })
    .onDuplicateKeyUpdate({
      set: { configVersion: next.configVersion, isPaused: next.isPaused },
    });
  await recordAuditEvent("BOT_CONFIGURATION_CHANGED", "TELEGRAM", actorId, { patch, configVersion: next.configVersion });
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
