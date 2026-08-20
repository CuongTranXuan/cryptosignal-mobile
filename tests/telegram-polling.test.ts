import { describe, expect, it } from "vitest";
import { formatSignalFindings, normalizeConfiguredSymbol, parseTelegramCommand, shouldStartTelegramPolling, telegramPollingBackoffMs } from "../server/telegram-polling";

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

  it("renders named confirmed pattern evidence with its closed-candle explanation", () => {
    expect(formatSignalFindings([{
      findingId: "confirmed-hammer",
      ruleFamily: "CANDLE_PATTERN",
      ruleId: "HAMMER_V1",
      direction: "BULLISH",
      strength: 0.06,
      evidence: { closedCandle: true },
    }])).toContain("Hammer — bullish: A lower shadow");
  });

  it("backs off after a getUpdates conflict instead of retrying the same token every few seconds", () => {
    expect(telegramPollingBackoffMs(new Error("Telegram getUpdates failed with 409: Conflict: terminated by other getUpdates request"))).toBe(60_000);
    expect(telegramPollingBackoffMs(new Error("Telegram getUpdates failed with 500"))).toBe(5_000);
  });

  it("keeps the web app independent of Telegram until a configured deployment explicitly opts in", () => {
    expect(shouldStartTelegramPolling({ NODE_ENV: "development" })).toBe(false);
    expect(shouldStartTelegramPolling({ NODE_ENV: "development", TELEGRAM_BOT_TOKEN: "token" })).toBe(false);
    expect(shouldStartTelegramPolling({ NODE_ENV: "production", TELEGRAM_BOT_TOKEN: "token" })).toBe(false);
    expect(shouldStartTelegramPolling({ NODE_ENV: "production", TELEGRAM_BOT_TOKEN: "token", TELEGRAM_POLLING_ENABLED: "true" })).toBe(true);
  });
});
