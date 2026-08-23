import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const projectRoot = resolve(import.meta.dirname, "..");
const pine = readFileSync(resolve(projectRoot, "tradingview/CryptoSignalClosedCandleVisualizer.pine"), "utf8");
const guide = readFileSync(resolve(projectRoot, "docs/TRADINGVIEW_VISUALIZER.md"), "utf8");

describe("TradingView closed-candle visualizer contract", () => {
  it("uses Pine v6 and visibly gates setup behavior on closed candles", () => {
    expect(pine).toContain("//@version=6");
    expect(pine).toContain("indicator(\"CryptoSignal · Closed-Candle Visualizer\"");
    expect(pine).toContain("closedCandle = barstate.isconfirmed");
    expect(pine).toContain("bullishSetup = closedCandle and score >= threshold");
    expect(pine).toContain("bearishSetup = closedCandle and score <= -threshold");
  });

  it("mirrors the documented score weights and remains non-executing", () => {
    for (const weight of ["0.30", "0.20", "0.10", "0.18", "0.16", "0.15", "0.12"]) expect(pine).toContain(weight);
    expect(pine).toContain("math.max(-1.0, math.min(1.0, score))");
    expect(pine).not.toMatch(/strategy\./);
    expect(pine).not.toMatch(/request\.security/);
  });

  it("draws closed-candle markers, exposes alert events, and documents TA-Lib parity limits", () => {
    expect(pine).toContain("plotshape(showBullish");
    expect(pine).toContain("plotshape(showBearish");
    expect(pine).toContain("alertcondition(newBullishSetup");
    expect(pine).toContain("alertcondition(newBearishSetup");
    expect(guide).toContain("**Parity boundary:**");
    expect(guide).toContain("TA-Lib");
    expect(guide).toContain("Once Per Bar Close");
  });
});
