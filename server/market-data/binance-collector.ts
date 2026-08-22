import { randomUUID } from "node:crypto";

import type { MarketComponentHealth } from "../../shared/live-market-types";
import { normalizeBinanceCombinedStream, type BinanceNormalizationContext } from "./normalize";
import { buildBinanceCombinedStreamUrl, type MarketCollectorConfig } from "./config";

type CollectorSocket = {
  on(event: "message" | "close" | "error", listener: (value?: unknown) => void): CollectorSocket;
  close(): void;
};

type CollectorDependencies = {
  config: MarketCollectorConfig;
  socketFactory: (url: string) => CollectorSocket;
  spool: { append(event: Parameters<typeof normalizeBinanceCombinedStream>[0] extends never ? never : NonNullable<ReturnType<typeof normalizeBinanceCombinedStream>>): Promise<unknown> };
  cache: { writeLatest(event: NonNullable<ReturnType<typeof normalizeBinanceCombinedStream>>): Promise<unknown> };
  publishClosedKline: (eventId: string) => Promise<unknown>;
  recordAuditEvent: (action: string, actorType: string, actorId: string, payload: unknown) => Promise<unknown>;
  recordHealth: (health: Omit<MarketComponentHealth, "updatedAt">) => Promise<unknown>;
  normalize?: (input: unknown, context: BinanceNormalizationContext) => ReturnType<typeof normalizeBinanceCombinedStream>;
  now?: () => Date;
  schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelSchedule?: (handle: ReturnType<typeof setTimeout>) => void;
};

export type BinanceCollector = {
  start(): Promise<void>;
  stop(): Promise<void>;
  getHealth(): Omit<MarketComponentHealth, "updatedAt">;
};

const MAX_CONNECTION_AGE_MS = 23 * 60 * 60 * 1_000 + 50 * 60 * 1_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

function unrefTimer(timer: ReturnType<typeof setTimeout>) {
  (timer as unknown as { unref?: () => void }).unref?.();
}

export function createBinanceCollector(dependencies: CollectorDependencies): BinanceCollector {
  const now = dependencies.now ?? (() => new Date());
  const normalize = dependencies.normalize ?? normalizeBinanceCombinedStream;
  const schedule = dependencies.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancelSchedule = dependencies.cancelSchedule ?? clearTimeout;
  let socket: CollectorSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let rotationTimer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let reconnectAttempt = 0;
  let connectionId = "";
  let health: Omit<MarketComponentHealth, "updatedAt"> = {
    component: "COLLECTOR",
    state: "IDLE",
    lastSuccessAt: null,
    lastError: null,
    lagMs: null,
    summary: {},
  };

  const persistHealth = async (state: MarketComponentHealth["state"], lastError: string | null = null) => {
    health = {
      component: "COLLECTOR",
      state,
      lastSuccessAt: state === "RUNNING" ? now() : health.lastSuccessAt,
      lastError,
      lagMs: health.lastSuccessAt ? Math.max(0, now().getTime() - health.lastSuccessAt.getTime()) : null,
      summary: { connectionId, reconnectAttempt },
    };
    await dependencies.recordHealth(health);
  };

  const clearTimers = () => {
    if (reconnectTimer) cancelSchedule(reconnectTimer);
    if (rotationTimer) cancelSchedule(rotationTimer);
    reconnectTimer = null;
    rotationTimer = null;
  };

  const scheduleReconnect = () => {
    if (!running || reconnectTimer) return;
    const delayMs = Math.min(1_000 * 2 ** reconnectAttempt, MAX_RECONNECT_DELAY_MS);
    reconnectAttempt += 1;
    reconnectTimer = schedule(() => {
      reconnectTimer = null;
      void connect();
    }, delayMs);
    unrefTimer(reconnectTimer);
  };

  const handleMessage = async (rawMessage: unknown) => {
    try {
      const value = typeof rawMessage === "string" ? rawMessage : String(rawMessage);
      const input = JSON.parse(value) as unknown;
      const event = normalize(input, { ingestedAt: now().toISOString(), sourceConnectionId: connectionId });
      if (!event) return;
      if (!dependencies.config.assetSymbols.includes(event.assetSymbol)) return;
      if (
        event.streamType === "KLINE_UPDATE" &&
        (typeof event.payload.interval !== "string" || !dependencies.config.timeframes.includes(event.payload.interval as MarketCollectorConfig["timeframes"][number]))
      ) {
        return;
      }

      await dependencies.spool.append(event);
      try {
        await dependencies.cache.writeLatest(event);
      } catch (error) {
        await persistHealth("DEGRADED", error instanceof Error ? error.message : "Market cache unavailable");
      }

      if (event.streamType === "KLINE_UPDATE" && event.isClosedCandle) {
        await dependencies.publishClosedKline(event.eventId);
        await dependencies.recordAuditEvent("LIVE_KLINE_CLOSED", "MARKET_COLLECTOR", "binance-public", {
          eventId: event.eventId,
          assetSymbol: event.assetSymbol,
          timeframe: event.payload.interval,
          dataQualityState: "LIVE_UNCONFIRMED",
        });
      }

      if (health.state !== "DEGRADED") {
        await persistHealth("RUNNING");
      }
    } catch (error) {
      await persistHealth("DEGRADED", error instanceof Error ? error.message : "Market collector message handling failed");
    }
  };

  const connect = async () => {
    if (!running) return;
    connectionId = `binance-public-${randomUUID()}`;
    const url = buildBinanceCombinedStreamUrl(dependencies.config);
    socket = dependencies.socketFactory(url);
    reconnectAttempt = 0;
    await persistHealth("RUNNING");

    socket.on("message", (message) => void handleMessage(message));
    socket.on("error", (error) => {
      void persistHealth("DEGRADED", error instanceof Error ? error.message : "Public Binance socket error");
    });
    socket.on("close", () => {
      socket = null;
      if (!running) return;
      void persistHealth("DEGRADED", "Public Binance socket closed");
      scheduleReconnect();
    });
    rotationTimer = schedule(() => socket?.close(), MAX_CONNECTION_AGE_MS);
    unrefTimer(rotationTimer);
  };

  return {
    async start() {
      if (running) return;
      running = true;
      await connect();
    },
    async stop() {
      running = false;
      clearTimers();
      socket?.close();
      socket = null;
      await persistHealth("IDLE");
    },
    getHealth() {
      return health;
    },
  };
}
