import { describe, expect, it } from "vitest";
import { normalizeConfiguredSymbol, parseTelegramCommand, shouldStartTelegramPolling, telegramPollingBackoffMs } from "../server/telegram-polling";

describe("Telegram long-polling commands", () => {
  it("normalizes bot suffixes and preserves command arguments", () => {
    expect(parseTelegramCommand("/signal@CryptoSignalBot BTCUSDT")).toEqual({
      command: "/signal",
      args: ["BTCUSDT"],
    });
  });

  it("does not define webhook handling as a command transport", () => {
    expect(parseTelegramCommand("/pause")).toEqual({ command: "/pause", args: [] });
  });

  it("recognizes the browser dashboard shortcut alongside operational command arguments", () => {
    expect(parseTelegramCommand("/web@CryptoSignalBot")).toEqual({ command: "/web", args: [] });
    expect(parseTelegramCommand("/timeframes add 30m")).toEqual({ command: "/timeframes", args: ["add", "30m"] });
  });

  it("normalizes only the explicitly supported public market symbols", () => {
    expect(normalizeConfiguredSymbol("ethusdt")).toBe("ETH/USDT");
    expect(normalizeConfiguredSymbol("DOGEUSDT")).toBeNull();
  });

  it("backs off after a getUpdates conflict instead of retrying the same token every few seconds", () => {
    expect(telegramPollingBackoffMs(new Error("Telegram getUpdates failed with 409: Conflict: terminated by other getUpdates request"))).toBe(60_000);
    expect(telegramPollingBackoffMs(new Error("Telegram getUpdates failed with 500"))).toBe(5_000);
  });

  it("keeps in-process polling for development but requires explicit production opt-in", () => {
    expect(shouldStartTelegramPolling({ NODE_ENV: "development" })).toBe(true);
    expect(shouldStartTelegramPolling({ NODE_ENV: "production" })).toBe(false);
    expect(shouldStartTelegramPolling({ NODE_ENV: "production", TELEGRAM_POLLING_ENABLED: "true" })).toBe(true);
  });
});
