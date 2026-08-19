export type ChartCandleInput = {
  candleCloseTime: string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  ema20: number;
  ema50: number;
  rsi14: number;
};

/** Removes invalid/duplicate time points so a chart series can be rendered in strictly ascending order. */
export function normalizeChartCandles<T extends ChartCandleInput>(candles: T[]): T[] {
  const unique = new Map<number, T>();
  for (const candle of candles) {
    const time = new Date(candle.candleCloseTime).getTime();
    const values = [candle.open, candle.high, candle.low, candle.close, candle.ema20, candle.ema50, candle.rsi14];
    if (!Number.isFinite(time) || values.some((value) => !Number.isFinite(value))) continue;
    unique.set(time, candle);
  }
  return [...unique.entries()].sort(([left], [right]) => left - right).map(([, candle]) => candle);
}
