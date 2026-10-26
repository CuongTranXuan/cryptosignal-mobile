import { formatMarketPrice } from "./format-market-price";
import { translateBackendText } from "./vi-evidence";

export const KNOWN_INVALIDATION_CONDITIONS = ["close_above", "close_below", "close_beyond"] as const;
export type KnownInvalidationCondition = (typeof KNOWN_INVALIDATION_CONDITIONS)[number];

const INVALIDATION_CONDITION_VI: Record<KnownInvalidationCondition, string> = {
  close_above: "Đóng nến trên",
  close_below: "Đóng nến dưới",
  close_beyond: "Đóng nến vượt",
};

export type InvalidationLike = {
  price: number;
  condition?: string | null;
  code?: string;
  text?: string;
};

export function labelForInvalidationCondition(condition: string | null | undefined): string {
  if (!condition?.trim()) return "";
  const normalized = condition.trim().toLowerCase().replace(/\s+/g, "_");
  if (normalized in INVALIDATION_CONDITION_VI) {
    return INVALIDATION_CONDITION_VI[normalized as KnownInvalidationCondition];
  }
  return translateBackendText(condition).replace(/_/g, " ");
}

/** Coded backends send Vietnamese `text`; older ones only the `condition` token. */
function conditionText(invalidation: InvalidationLike): string {
  const text = invalidation.text?.trim();
  if (text && invalidation.code) return text;
  const label = labelForInvalidationCondition(invalidation.condition);
  return label || (text ? translateBackendText(text) : "");
}

export function formatInvalidationLine(
  invalidation: InvalidationLike | null | undefined,
  symbol: string,
): string | null {
  if (!invalidation) return null;
  const price = formatMarketPrice(invalidation.price, symbol);
  const cond = conditionText(invalidation);
  if (!cond) return price;
  return cond.includes(price) ? cond : `${price} — ${cond}`;
}
