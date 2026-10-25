import { formatMarketPrice } from "./format-market-price";

export const KNOWN_INVALIDATION_CONDITIONS = ["close_above", "close_below"] as const;
export type KnownInvalidationCondition = (typeof KNOWN_INVALIDATION_CONDITIONS)[number];

const INVALIDATION_CONDITION_VI: Record<KnownInvalidationCondition, string> = {
  close_above: "Đóng nến trên",
  close_below: "Đóng nến dưới",
};

export type InvalidationLike = {
  price: number;
  condition?: string | null;
};

export function labelForInvalidationCondition(condition: string | null | undefined): string {
  if (!condition?.trim()) return "";
  const normalized = condition.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized in INVALIDATION_CONDITION_VI) {
    return INVALIDATION_CONDITION_VI[normalized as KnownInvalidationCondition];
  }
  return condition.replace(/_/g, " ");
}

export function formatInvalidationLine(
  invalidation: InvalidationLike | null | undefined,
  symbol: string,
): string | null {
  if (!invalidation) return null;
  const price = formatMarketPrice(invalidation.price, symbol);
  const cond = labelForInvalidationCondition(invalidation.condition);
  return cond ? `${price} — ${cond}` : price;
}
