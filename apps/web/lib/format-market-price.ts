/** Binance spot tick sizes for chart-aligned price labels (PRICE_FILTER tickSize). */

const TICK_SIZE_BY_SYMBOL: Record<string, number> = {
  BTCUSDT: 0.01,
  ETHUSDT: 0.01,
  BNBUSDT: 0.01,
  SOLUSDT: 0.01,
  XRPUSDT: 0.0001,
};

export function tickSizeForSymbol(symbol: string): number {
  const key = symbol.replaceAll("/", "").toUpperCase();
  return TICK_SIZE_BY_SYMBOL[key] ?? 0.01;
}

export function decimalPlacesFromTickSize(tickSize: number): number {
  if (!Number.isFinite(tickSize) || tickSize <= 0) return 2;
  const text = tickSize.toString();
  if (!text.includes(".")) return 0;
  const fraction = text.split(".")[1] ?? "";
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed.length > 0 ? trimmed.length : fraction.length;
}

/** Format like the chart price scale: grouped thousands, tick precision. */
export function formatMarketPrice(price: number, symbol: string): string {
  const decimals = decimalPlacesFromTickSize(tickSizeForSymbol(symbol));
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(price);
}
