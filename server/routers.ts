import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const";
import { getBotConfig, listSignalSnapshots, recordSignalSnapshot } from "./db";
import { signalSnapshotSchema } from "./signal-ingest";
import { getCachedTelegramBotLink } from "./telegram-polling";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";

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
    latest: publicProcedure.query(async () => (await listSignalSnapshots(1))[0] ?? null),
    list: publicProcedure.input(z.object({ limit: z.number().int().min(1).max(100).default(30) })).query(({ input }) => listSignalSnapshots(input.limit)),
  }),
  bot: router({
    status: publicProcedure.query(async () => {
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
        executionEnabled: false,
      };
    }),
    config: publicProcedure.query(() => getBotConfig()),
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
