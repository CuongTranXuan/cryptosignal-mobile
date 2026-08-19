import { describe, expect, it } from "vitest";
import { normalizeConfiguredSymbol, parseTelegramCommand } from "../server/telegram-polling";

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
});
