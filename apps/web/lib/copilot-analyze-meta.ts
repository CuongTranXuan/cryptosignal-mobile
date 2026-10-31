import type { AnalyzeMetaEvent } from "./copilot-schema";
import {
  COPILOT_EFFECTIVE_CANDLES,
  COPILOT_EFFECTIVE_CANDLES_CLAMPED,
  COPILOT_META_CLAMPED_DETAIL,
} from "./copilot-strings";

/**
 * User-visible note for the latest analyze `meta` event (last event wins).
 * When `clamped` and requested > used, explain the server-side reduction (retry / budget).
 */
export function formatAnalyzeMetaNotice(meta: AnalyzeMetaEvent | null): string | null {
  if (!meta) return null;
  if (meta.clamped && meta.candle_count_requested > meta.candle_count_used) {
    return COPILOT_META_CLAMPED_DETAIL
      .replace("{requested}", String(meta.candle_count_requested))
      .replace("{used}", String(meta.candle_count_used));
  }
  if (meta.clamped) {
    return COPILOT_EFFECTIVE_CANDLES_CLAMPED.replace("{count}", String(meta.candle_count_used));
  }
  return COPILOT_EFFECTIVE_CANDLES.replace("{count}", String(meta.candle_count_used));
}
