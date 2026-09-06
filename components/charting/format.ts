import type { UTCTimestamp } from "lightweight-charts";

export function chartTimestamp(value: string | Date): UTCTimestamp {
  return Math.floor(new Date(value).getTime() / 1000) as UTCTimestamp;
}

export function formatChartPrice(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: value >= 1000 ? 2 : 5 });
}
