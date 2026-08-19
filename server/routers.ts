import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { getBotConfig, getChartWindow, listSignalSnapshots, recordSignalSnapshot, setBotPaused, updateBotConfig } from "./db";
import { signalSnapshotSchema } from "./signal-ingest";
import { getCachedTelegramBotLink, getTelegramPollingHealth } from "./telegram-polling";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { dashboardProtectedProcedure, publicProcedure, router } from "./_core/trpc";

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
      .input(z.object({ assetSymbol: z.enum(["BTC/USDT", "ETH/USDT", "BNB/USDT"]), timeframe: z.enum(["30m", "1h", "4h"]), limit: z.number().int().min(30).max(500).default(180) }))
      .query(({ input }) => getChartWindow(input.assetSymbol, input.timeframe, input.limit)),
  }),
  bot: router({
    status: dashboardProtectedProcedure.query(async () => {
      const [config, latest] = await Promise.all([getBotConfig(), listSignalSnapshots(1)]);
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
        executionEnabled: false,
      };
    }),
    config: dashboardProtectedProcedure.query(() => getBotConfig()),
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
      setRuleFamilies: dashboardProtectedProcedure.input(z.object({ ruleFamilies: z.array(z.enum(["TREND", "MOMENTUM", "VOLUME", "CANDLE_PATTERN", "WYCKOFF", "SMC", "ELLIOTT_EXPERIMENTAL"])) .max(7) })).mutation(async ({ input }) => {
        const current = await getBotConfig();
        return updateBotConfig({ ruleFamilies: input.ruleFamilies }, "dashboard", current, "DASHBOARD");
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
