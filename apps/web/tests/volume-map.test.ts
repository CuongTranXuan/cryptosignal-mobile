import { describe, expect, it } from "vitest";
import type { Candle } from "../lib/pattern-shape";
import { toVolumeData } from "../lib/volume-map";

const candle = (overrides: Partial<Candle> = {}): Candle => ({
  time: 100,
  open: 10,
  high: 12,
  low: 9,
  close: 11,
  volume: 50,
  ...overrides,
});

describe("volume-map", () => {
  it("maps candle volume to histogram bars with Binance up/down colors", () => {
    expect(
      toVolumeData([
        candle({ time: 1, open: 10, close: 11, volume: 20 }),
        candle({ time: 2, open: 11, close: 11, volume: 15 }),
        candle({ time: 3, open: 11, close: 10, volume: 8 }),
      ]),
    ).toEqual([
      { time: 1, value: 20, color: "#0ecb81" },
      { time: 2, value: 15, color: "#0ecb81" },
      { time: 3, value: 8, color: "#f6465d" },
    ]);
  });
});
