import { CHART_THEME } from "./chart-theme";
import type { Candle } from "./pattern-shape";

export type VolumeBar = {
  time: number;
  value: number;
  color: string;
};

export function toVolumeData(candles: Candle[]): VolumeBar[] {
  return candles.map((c) => ({
    time: c.time,
    value: c.volume,
    color: c.close >= c.open ? CHART_THEME.green : CHART_THEME.red,
  }));
}
