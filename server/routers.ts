import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { LIVE_ASSET_SYMBOLS, LIVE_CONDITION_IDS, type MarketComponentHealth } from "../shared/live-market-types";
import { CANDLE_PATTERN_RULE_IDS, METHODOLOGY_RULE_IDS, RULE_FAMILY_IDS } from "../shared/signal-types";
import { getBotConfig, getChartWindow, getMarketPipelineHealth, getRunnerHealth, listAuditEvents, listLiveObservations, listSignalSnapshots, recordMarketPipelineHealth, recordSignalSnapshot, setBotPaused, updateBotConfig } from "./db";
import { createConfiguredReplayService, MAX_REPLAY_EVENTS, MAX_REPLAY_WINDOW_MS, MarketCacheUnavailableError, readConfiguredLiveSnapshot } from "./market-data/replay";
import { signalSnapshotSchema } from "./signal-ingest";
import { getCachedTelegramBotLink, getTelegramPollingHealth } from "./telegram-polling";
import { refreshPublicCandleResearch } from "./public-candle-refresh";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { dashboardProtectedProcedure, publicProcedure, router } from "./_core/trpc";

const liveAssetSymbolSchema = z.enum(LIVE_ASSET_SYMBOLS);
const marketComponentIds = ["COLLECTOR", "EVALUATOR", "MCP", "WRITER"] as const;

const replayWindowSchema = z
  .object({
    assetSymbol: liveAssetSymbolSchema,
    from: z.string().min(1),
    to: z.string().min(1),
    limit: z.number().int().min(1).max(MAX_REPLAY_EVENTS).default(1_000),
  })
  .superRefine((value, ctx) => {
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) {
      ctx.addIssue({ code: "custom", message: "Replay requires an increasing ISO-8601 time range" });
      return;
    }
    if (to - from > MAX_REPLAY_WINDOW_MS) {
      ctx.addIssue({ code: "custom", message: "Replay window cannot exceed seven days" });
    }
  });

function completeMarketHealth(rows: MarketComponentHealth[]): MarketComponentHealth[] {
  const byComponent = new Map(rows.map((row) => [row.component, row]));
  return marketComponentIds.map((component) =>
    byComponent.get(component) ?? {
      component,
      state: "IDLE",
      lastSuccessAt: null,
      lastError: null,
      lagMs: null,
      summary: {},
      updatedAt: null,
    },
  );
}

export function sanitizeMarketHealthText(value: string) {
  return value
    .replace(/(?:https?|redis|mysql|postgres):\/\/[^\s]+/gi, "[endpoint redacted]")
    .replace(/(token|password|secret|accesskey|signature|authorization)(\s*[=:]\s*)[^\s,;]+/gi, (_match, key: string, separator: string) => `${key}${separator}[redacted]`);
}

export function sanitizeMarketHealth(rows: MarketComponentHealth[]) {
  return completeMarketHealth(rows).map((row) => ({
    ...row,
    lastError: row.lastError ? sanitizeMarketHealthText(row.lastError) : null,
    summary: Object.fromEntries(
      Object.entries(row.summary).filter(([key]) => !/(secret|password|token|credential|endpoint|url)/i.test(key)),
    ),
  }));
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  signal: router({
    latest: dashboardProtectedProcedure.query(async () => (await listSignalSnapshots(1))[0] ?? null),
    list: dashboardProtectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(30) })).query(({ input }) => listSignalSnapshots(input.limit)),
  }),
  market: router({
    chart: dashboardProtectedProcedure
      .input(z.object({ assetSymbol: liveAssetSymbolSchema, timeframe: z.enum(["30m", "1h", "4h"]), limit: z.number().int().min(30).max(500).default(180) }))
      .query(({ input }) => getChartWindow(input.assetSymbol, input.timeframe, input.limit)),
    liveSnapshot: dashboardProtectedProcedure.input(z.object({ assetSymbol: liveAssetSymbolSchema })).query(async ({ input }) => {
      try {
        return await readConfiguredLiveSnapshot(input.assetSymbol);
      } catch (error) {
        if (error instanceof MarketCacheUnavailableError) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Live market cache is temporarily unavailable" });
        }
        throw error;
      }
    }),
    replay: dashboardProtectedProcedure.input(replayWindowSchema).query(async ({ input }) => {
      const replay = createConfiguredReplayService();
      try {
        return await replay.queryReplayWindow(input);
      } catch (error) {
        try {
          await recordMarketPipelineHealth({
            component: "WRITER",
            state: "DEGRADED",
            lastSuccessAt: null,
            lastError: error instanceof Error ? error.message : "ClickHouse replay failure",
            lagMs: null,
            summary: { operation: "replay" },
          });
        } catch {
          // Preserve the primary ClickHouse failure even if the control-plane database is also unavailable.
        }
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Historical market replay is temporarily unavailable" });
      } finally {
        await replay.close();
      }
    }),
    health: dashboardProtectedProcedure.query(async () => sanitizeMarketHealth(await getMarketPipelineHealth())),
    liveObservations: dashboardProtectedProcedure.input(z.object({ limit: z.number().int().min(1).max(30).default(10) })).query(({ input }) => listLiveObservations(input.limit)),
  }),
  bot: router({
    status: dashboardProtectedProcedure.query(async () => {
      const [config, latest, runnerHealth] = await Promise.all([getBotConfig(), listSignalSnapshots(1), getRunnerHealth()]);
      return {
        mode: "SIGNALS_ONLY" as const,
        isPaused: config.isPaused,
        configVersion: config.configVersion,
        watchlist: config.watchlist,
        timeframes: config.timeframes,
        latestSignalAt: latest[0]?.candleCloseTime ?? null,
        telegramMode: "LONG_POLLING" as const,
        telegramBotUrl: getCachedTelegramBotLink(),
        telegramPoller: getTelegramPollingHealth(),
        runnerHealth,
        executionEnabled: false,
      };
    }),
    config: dashboardProtectedProcedure.query(() => getBotConfig()),
    auditHistory: dashboardProtectedProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(30) })).query(({ input }) => listAuditEvents(input.limit)),
    refreshPublicData: dashboardProtectedProcedure
      .input(z.object({ assetSymbol: liveAssetSymbolSchema, timeframe: z.enum(["30m", "1h", "4h"]) }))
      .mutation(({ input }) => refreshPublicCandleResearch(input)),
    controls: router({
      setPaused: dashboardProtectedProcedure.input(z.object({ isPaused: z.boolean() })).mutation(({ input }) => setBotPaused(input.isPaused, "dashboard", "DASHBOARD")),
      setWatchlist: dashboardProtectedProcedure.input(z.object({ watchlist: z.array(z.enum(["BTC/USDT", "ETH/USDT", "BNB/USDT"])) .min(1).max(3) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ watchlist: input.watchlist }, "dashboard", current, "DASHBOARD");
      }),
      setTimeframes: dashboardProtectedProcedure.input(z.object({ timeframes: z.array(z.enum(["30m", "1h", "4h"])) .min(1).max(3) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ timeframes: input.timeframes }, "dashboard", current, "DASHBOARD");
      }),
      setThreshold: dashboardProtectedProcedure.input(z.object({ alertThreshold: z.number().min(0).max(1) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ alertThreshold: input.alertThreshold }, "dashboard", current, "DASHBOARD");
      }),
      setCooldown: dashboardProtectedProcedure.input(z.object({ cooldownMinutes: z.number().int().min(1).max(1440) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ cooldownMinutes: input.cooldownMinutes }, "dashboard", current, "DASHBOARD");
      }),
      setLiveAlerts: dashboardProtectedProcedure
        .input(
          z
            .object({
              enabled: z.boolean(),
              conditionIds: z.array(z.enum(LIVE_CONDITION_IDS)).max(LIVE_CONDITION_IDS.length),
              threshold: z.number().min(0).max(1),
              cooldownMinutes: z.number().int().min(1).max(1440),
            })
            .refine((value) => !value.enabled || value.conditionIds.length > 0, "Enabled live alerts require at least one condition"),
        )
        .mutation(async ({ input }) => {
          const current = await getBotConfig();
          return updateBotConfig({ liveAlerts: input }, "dashboard", current, "DASHBOARD");
        }),
      setRuleFamilies: dashboardProtectedProcedure.input(z.object({ ruleFamilies: z.array(z.enum(RULE_FAMILY_IDS)).max(7) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ ruleFamilies: input.ruleFamilies }, "dashboard", current, "DASHBOARD");
      }),
      setEnabledPatterns: dashboardProtectedProcedure.input(z.object({ enabledPatterns: z.array(z.string().refine((ruleId) => CANDLE_PATTERN_RULE_IDS.includes(ruleId as typeof CANDLE_PATTERN_RULE_IDS[number]), "Unsupported candle pattern")).min(1).max(CANDLE_PATTERN_RULE_IDS.length) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ enabledPatterns: input.enabledPatterns as typeof current.enabledPatterns }, "dashboard", current, "DASHBOARD");
      }),
      setEnabledMethodologies: dashboardProtectedProcedure.input(z.object({ enabledMethodologies: z.array(z.string().refine((ruleId) => METHODOLOGY_RULE_IDS.includes(ruleId as typeof METHODOLOGY_RULE_IDS[number]), "Unsupported methodology rule")).min(1).max(METHODOLOGY_RULE_IDS.length) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ enabledMethodologies: input.enabledMethodologies as typeof current.enabledMethodologies }, "dashboard", current, "DASHBOARD");
      }),
    }),
  }),
  ingestion: router({
    health: publicProcedure.input(z.object({ token: z.string().min(1) })).query(({ input }) => {
      const expected = process.env.SIGNAL_INGEST_TOKEN;
      if (!expected || input.token !== expected) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid signal ingestion token" });
      }
      return { ok: true as const, mode: "SIGNALS_ONLY" as const };
    }),
    recordSignal: publicProcedure
      .input(z.object({ token: z.string().min(1), snapshot: signalSnapshotSchema }))
      .mutation(async ({ input }) => {
        const expected = process.env.SIGNAL_INGEST_TOKEN;
        if (!expected || input.token !== expected) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid signal ingestion token" });
        }
        return recordSignalSnapshot(input.snapshot);
      }),
  }),
});

export type AppRouter = typeof appRouter;
